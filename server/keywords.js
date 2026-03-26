const axios = require('axios');
const cheerio = require('cheerio');
const net = require('node:net');

const {
    runKeywordResearchV2,
    runLegacyKeywordResearch,
} = require('./keywordResearchService');

function normalizeScanUrl(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) {
        return '';
    }

    const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
        const parsed = new URL(withProtocol);
        if (!['http:', 'https:'].includes(parsed.protocol)) {
            return '';
        }
        return parsed.toString();
    } catch {
        return '';
    }
}

function isPrivateHostname(hostname) {
    const normalized = String(hostname || '').trim().toLowerCase();
    if (!normalized) {
        return true;
    }

    if (normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '::1') {
        return true;
    }

    if (normalized.endsWith('.local')) {
        return true;
    }

    const ipType = net.isIP(normalized);
    if (ipType === 4) {
        const parts = normalized.split('.').map((part) => Number(part));
        if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
            return true;
        }

        if (parts[0] === 10 || parts[0] === 127 || parts[0] === 0) {
            return true;
        }

        if (parts[0] === 169 && parts[1] === 254) {
            return true;
        }

        if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
            return true;
        }

        if (parts[0] === 192 && parts[1] === 168) {
            return true;
        }

        return false;
    }

    if (ipType === 6) {
        return normalized === '::1'
            || normalized.startsWith('fc')
            || normalized.startsWith('fd')
            || normalized.startsWith('fe80');
    }

    return false;
}

async function researchKeywordV2(req, res) {
    const seed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
    if (!seed) {
        return res.status(400).json({ error: 'Seed keyword required' });
    }

    try {
        const result = await runKeywordResearchV2(seed, {
            projectId: req.body?.projectId || null,
        });
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

    let parsedUrl;
    try {
        parsedUrl = new URL(normalizedUrl);
    } catch {
        return res.status(400).json({ error: 'URL must be a valid http(s) address' });
    }

    if (isPrivateHostname(parsedUrl.hostname)) {
        return res.status(400).json({ error: 'Private and localhost URLs are not allowed' });
    }

    try {
        console.log(`[Content Scanner] Fetching: ${normalizedUrl}`);
        const response = await axios.get(normalizedUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout: 5000,
            maxRedirects: 5,
        });

        const $ = cheerio.load(response.data);
        $('script, style, noscript, nav, footer, header').remove();
        const text = $('body').text().replace(/\s+/g, ' ').toLowerCase().trim();

        const words = text.split(/[^a-z0-9]+/).filter(Boolean).slice(0, 50000);
        if (words.length === 0) {
            return res.json({ url: normalizedUrl, totalWords: 0, topKeywords: [] });
        }

        const stopWords = new Set(['the', 'and', 'to', 'of', 'a', 'in', 'is', 'that', 'for', 'it', 'on', 'with', 'as', 'are', 'this', 'by', 'be', 'at', 'or', 'from', 'an', 'was', 'not', 'but', 'can', 'will', 'if', 'has', 'more', 'about', 'one', 'all', 'so', 'we', 'your', 'my', 'you', 'they', 'our', 'us', 'do', 'how']);

        const ngrams = {};
        const addNgram = (phrase) => {
            if (phrase.split(' ').some((word) => stopWords.has(word) || word.length < 3)) {
                return;
            }
            ngrams[phrase] = (ngrams[phrase] || 0) + 1;
        };

        for (let index = 0; index < words.length; index += 1) {
            if (words[index].length > 2 && !stopWords.has(words[index])) {
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

        return res.json({ url: normalizedUrl, totalWords: words.length, topKeywords });
    } catch (error) {
        console.error('Content Scan Failed:', error.message);
        return res.status(500).json({ error: 'Failed to scan page content. It might be blocking bots.' });
    }
}

module.exports = {
    researchKeyword,
    researchKeywordV2,
    analyzePageContent,
    __internal: {
        normalizeScanUrl,
        isPrivateHostname,
    },
};
