const axios = require('axios');
const cheerio = require('cheerio');

const {
    runKeywordResearchV2,
    runLegacyKeywordResearch,
} = require('./keywordResearchService');
const { persistKeywordResearchResult } = require('./keywordResearchPersistence');
const { launchBrowser } = require('./browser');
const { assertPublicHttpUrl, isPrivateHostname, normalizePublicHttpUrl } = require('./networkSafety');

const STATIC_SCAN_TIMEOUT_MS = 5000;
const RENDER_TOTAL_TIMEOUT_MS = 10000;
const RENDER_SETTLE_TIMEOUT_MS = 8000;
const RENDER_STABLE_WINDOW_MS = 1500;
const RENDER_POLL_INTERVAL_MS = 250;
const STATIC_FALLBACK_WORD_THRESHOLD = 120;
const STATIC_SPA_WORD_THRESHOLD = 400;
const SCAN_NOISE_SELECTOR = 'script, style, noscript, nav, footer, header, svg, canvas, iframe, template';
const ANALYTICS_URL_PATTERN = /(googletagmanager|google-analytics|analytics|doubleclick|hotjar|segment|clarity|mixpanel|facebook\.net|fullstory|amplitude)/i;
const BLOCKED_RENDER_RESOURCE_TYPES = new Set(['image', 'media', 'font', 'texttrack']);
const STOP_WORDS = new Set([
    'the', 'and', 'to', 'of', 'a', 'in', 'is', 'that', 'for', 'it', 'on', 'with', 'as', 'are', 'this', 'by',
    'be', 'at', 'or', 'from', 'an', 'was', 'not', 'but', 'can', 'will', 'if', 'has', 'more', 'about', 'one',
    'all', 'so', 'we', 'your', 'my', 'you', 'they', 'our', 'us', 'do', 'how',
]);

function normalizeScanUrl(value) {
    return normalizePublicHttpUrl(value);
}

function extractWords(text) {
    return String(text || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter(Boolean)
        .slice(0, 50000);
}

function buildKeywordScanResult(url, text, scanSource) {
    const words = extractWords(text);
    if (words.length === 0) {
        return { url, totalWords: 0, topKeywords: [], scanSource };
    }

    const ngrams = {};
    const addNgram = (phrase) => {
        if (phrase.split(' ').some((word) => STOP_WORDS.has(word) || word.length < 3)) {
            return;
        }
        ngrams[phrase] = (ngrams[phrase] || 0) + 1;
    };

    for (let index = 0; index < words.length; index += 1) {
        if (words[index].length > 2 && !STOP_WORDS.has(words[index])) {
            ngrams[words[index]] = (ngrams[words[index]] || 0) + 1;
        }
        if (index < words.length - 1) {
            addNgram(`${words[index]} ${words[index + 1]}`);
        }
        if (index < words.length - 2) {
            addNgram(`${words[index]} ${words[index + 1]} ${words[index + 2]}`);
        }
    }

    const topKeywords = Object.entries(ngrams)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 20)
        .map(([keyword, count]) => ({
            keyword,
            count,
            density: `${((count / words.length) * 100).toFixed(2)}%`,
        }));

    return {
        url,
        totalWords: words.length,
        topKeywords,
        scanSource,
    };
}

function hasSpaShellMarkers(html) {
    return /id=["'](?:root|__next|app)["']|data-reactroot/i.test(String(html || ''));
}

function shouldUseRenderedFallback(snapshot) {
    if (!snapshot) {
        return true;
    }

    if (snapshot.wordCount < STATIC_FALLBACK_WORD_THRESHOLD) {
        return true;
    }

    return snapshot.hasSpaShellMarkers && snapshot.wordCount < STATIC_SPA_WORD_THRESHOLD;
}

function createScanError(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
}

function normalizeStaticScanText($) {
    $(SCAN_NOISE_SELECTOR).remove();
    return $('body').text().replace(/\s+/g, ' ').trim();
}

async function fetchStaticPageSnapshot(url) {
    const response = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        timeout: STATIC_SCAN_TIMEOUT_MS,
        maxRedirects: 5,
    });

    const html = String(response.data || '');
    const $ = cheerio.load(html);
    const text = normalizeStaticScanText($);

    return {
        text,
        wordCount: extractWords(text).length,
        hasSpaShellMarkers: hasSpaShellMarkers(html),
        title: $('title').first().text().trim(),
        description: $('meta[name="description"]').attr('content') || '',
    };
}

async function delay(ms) {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

async function getRenderedTextSample(page) {
    return page.evaluate((noiseSelector) => {
        const body = document.body;
        if (!body) {
            return { text: '', wordCount: 0 };
        }

        const clone = body.cloneNode(true);
        clone.querySelectorAll(noiseSelector).forEach((node) => node.remove());
        const text = (clone.innerText || clone.textContent || '').replace(/\s+/g, ' ').trim();
        const wordCount = text
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean)
            .length;

        return { text, wordCount };
    }, SCAN_NOISE_SELECTOR);
}

async function waitForRenderedText(page, maxWaitMs) {
    const startedAt = Date.now();
    let lastWordCount = -1;
    let stableSince = Date.now();
    let latest = { text: '', wordCount: 0 };

    while (Date.now() - startedAt <= maxWaitMs) {
        latest = await getRenderedTextSample(page);

        if (latest.wordCount !== lastWordCount) {
            lastWordCount = latest.wordCount;
            stableSince = Date.now();
        } else if (latest.wordCount >= STATIC_FALLBACK_WORD_THRESHOLD && Date.now() - stableSince >= RENDER_STABLE_WINDOW_MS) {
            return latest;
        }

        await delay(RENDER_POLL_INTERVAL_MS);
    }

    return latest;
}

async function fetchRenderedPageSnapshot(url) {
    const browser = await launchBrowser();

    try {
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
        await page.setRequestInterception(true);
        page.on('request', (request) => {
            const resourceType = request.resourceType();
            const requestUrl = request.url();
            if (BLOCKED_RENDER_RESOURCE_TYPES.has(resourceType) || ANALYTICS_URL_PATTERN.test(requestUrl)) {
                request.abort();
                return;
            }

            request.continue();
        });

        const startedAt = Date.now();
        let response;
        try {
            response = await page.goto(url, {
                waitUntil: 'domcontentloaded',
                timeout: RENDER_TOTAL_TIMEOUT_MS,
            });
        } catch (error) {
            throw createScanError('render_timeout', error instanceof Error ? error.message : 'Render timed out');
        }

        const elapsedMs = Date.now() - startedAt;
        const remainingMs = Math.max(0, Math.min(RENDER_SETTLE_TIMEOUT_MS, RENDER_TOTAL_TIMEOUT_MS - elapsedMs));
        const rendered = await waitForRenderedText(page, remainingMs);
        const status = response?.status?.() ?? null;

        if (rendered.wordCount === 0 && (status === 401 || status === 403 || status === 429)) {
            throw createScanError('bot_blocked', `Page returned HTTP ${status} before exposing readable content`);
        }

        if (rendered.wordCount === 0) {
            throw createScanError('empty_rendered_content', 'Rendered page did not expose readable content');
        }

        return rendered;
    } finally {
        await browser.close();
    }
}

function toScanError(error) {
    if (error?.code === 'render_timeout') {
        return createScanError('render_timeout', 'Render timed out before usable page content appeared.');
    }

    if (error?.code === 'bot_blocked') {
        return createScanError('bot_blocked', 'The page blocked automated scanning before usable content appeared.');
    }

    if (error?.code === 'empty_rendered_content') {
        return createScanError('empty_rendered_content', 'Rendered page loaded but exposed no readable content.');
    }

    if (axios.isAxiosError(error) && (error.response?.status === 401 || error.response?.status === 403 || error.response?.status === 429)) {
        return createScanError('bot_blocked', `The page blocked automated scanning with HTTP ${error.response.status}.`);
    }

    return error;
}

async function autoSaveKeywordResearch(req, result) {
    await persistKeywordResearchResult(req.user, result, {
        projectId: req.body?.projectId || result?.projectId || null,
    });
}

async function researchKeywordV2(req, res) {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
    if (!seed) {
        return res.status(400).json({ error: 'Seed keyword required' });
    }

    try {
        const result = await runKeywordResearchV2(seed, {
            projectId: req.body?.projectId || null,
            user: req.user,
        });
        await autoSaveKeywordResearch(req, result);
        return res.json(result);
    } catch (error) {
        console.error('Advanced Research Failed:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function researchKeyword(req, res) {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
    if (!seed) {
        return res.status(400).json({ error: 'Seed keyword required' });
    }

    try {
        const result = await runLegacyKeywordResearch(seed, {
            projectId: req.body?.projectId || null,
        });
        await autoSaveKeywordResearch(req, result);
        return res.json(result);
    } catch (error) {
        console.error('Research Failed:', error);
        return res.status(500).json({ error: error.message });
    }
}

async function analyzePageContent(req, res) {
    const normalizedUrl = normalizeScanUrl(req.body?.url);
    if (!normalizedUrl) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        await assertPublicHttpUrl(normalizedUrl);
        console.log(`[Content Scanner] Fetching: ${normalizedUrl}`);

        let staticSnapshot = null;

        try {
            staticSnapshot = await fetchStaticPageSnapshot(normalizedUrl);
        } catch (error) {
            console.warn(`[Content Scanner] Static fetch failed for ${normalizedUrl}: ${error.message}`);
        }

        if (staticSnapshot && !shouldUseRenderedFallback(staticSnapshot)) {
            return res.json(buildKeywordScanResult(normalizedUrl, staticSnapshot.text, 'static'));
        }

        const renderedSnapshot = await fetchRenderedPageSnapshot(normalizedUrl);
        return res.json(buildKeywordScanResult(normalizedUrl, renderedSnapshot.text, 'rendered'));
    } catch (error) {
        const normalizedError = toScanError(error);
        if (normalizedError instanceof Error && /localhost|private|valid public http\(s\)|hostname could not be resolved/i.test(normalizedError.message)) {
            return res.status(400).json({ error: normalizedError.message });
        }

        console.error('Content Scan Failed:', normalizedError.message);
        return res.status(500).json({ error: normalizedError.message || 'Failed to scan page content. It might be blocking bots.' });
    }
}

module.exports = {
    researchKeyword,
    researchKeywordV2,
    analyzePageContent,
    __internal: {
        buildKeywordScanResult,
        hasSpaShellMarkers,
        normalizeScanUrl,
        isPrivateHostname,
        shouldUseRenderedFallback,
    },
};
