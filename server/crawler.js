const { google } = require('googleapis');
const { getAuthClient } = require('./auth');
const { URL } = require('url');
const gsc = require('./gsc');
const ga4 = require('./ga4');
const { summarizeStructuredData } = require('./structuredData');
const { fetchSitemapUrls, fetchSitemapUrlsGscPrimary } = require('./sitemaps');
const { LinkCheckCache } = require('./models');
const { annotateTechnicalIssues } = require('./auditIssueDetector');

const MAX_INTERNAL_LINK_TARGETS = 100;
const MAX_UNIQUE_LINK_CHECKS_PER_RUN = 500;
const LINK_CHECK_CACHE_TTL_MS = Math.max(15 * 60 * 1000, Number(process.env.LINK_CHECK_CACHE_TTL_MS || 6 * 60 * 60 * 1000));
const CRAWL_BATCH_SIZE = Math.max(1, Number(process.env.CRAWL_BATCH_SIZE || 2));
const CRAWL_NAVIGATION_TIMEOUT_MS = Math.max(10000, Number(process.env.CRAWL_NAVIGATION_TIMEOUT_MS || 45000));
const CRAWL_CONTENT_WAIT_TIMEOUT_MS = Math.max(2000, Number(process.env.CRAWL_CONTENT_WAIT_TIMEOUT_MS || 6000));
const CRAWL_SETTLE_DELAY_MS = Math.max(0, Number(process.env.CRAWL_SETTLE_DELAY_MS || 1200));
const CRAWL_SPA_RETRY_ATTEMPTS = Math.max(1, Number(process.env.CRAWL_SPA_RETRY_ATTEMPTS || 4));
const CRAWL_SPA_RETRY_INTERVAL_MS = Math.max(250, Number(process.env.CRAWL_SPA_RETRY_INTERVAL_MS || 1000));
const CONTENT_READY_SELECTOR = 'body, title, h1, meta[name="description"], main, article';

function normalizeComparableUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return '';
    }

    try {
        const parsed = new URL(value);
        parsed.hash = '';
        parsed.protocol = parsed.protocol.toLowerCase();
        parsed.hostname = parsed.hostname.toLowerCase();

        const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
    } catch {
        return value.trim().replace(/\/+$/, '') || value.trim();
    }
}

function isInternalUrl(value, siteUrl) {
    try {
        const candidate = new URL(value);
        const site = new URL(siteUrl);
        return candidate.origin.toLowerCase() === site.origin.toLowerCase();
    } catch {
        return false;
    }
}

function uniqueNormalizedLinks(links, siteUrl, options = {}) {
    const includeInternal = options.includeInternal !== false;
    const includeExternal = options.includeExternal === true;
    const limit = Number(options.limit || MAX_INTERNAL_LINK_TARGETS);
    const seen = new Set();
    const normalized = [];

    for (const link of Array.isArray(links) ? links : []) {
        const normalizedLink = normalizeComparableUrl(link);
        if (!normalizedLink || seen.has(normalizedLink)) {
            continue;
        }

        const internal = isInternalUrl(normalizedLink, siteUrl);
        if ((internal && !includeInternal) || (!internal && !includeExternal)) {
            continue;
        }

        seen.add(normalizedLink);
        normalized.push(normalizedLink);

        if (normalized.length >= limit) {
            break;
        }
    }

    return normalized;
}

function sameOrigin(left, right) {
    try {
        return new URL(left).origin.toLowerCase() === new URL(right).origin.toLowerCase();
    } catch {
        return false;
    }
}

function normalizeTrafficPathKey(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return '';
    }

    try {
        const parsed = new URL(value);
        const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${pathname}${parsed.search}`;
    } catch {
        return value.trim().replace(/\/+$/, '') || value.trim();
    }
}

function findCycleNodes(graph) {
    const visited = new Set();
    const active = new Set();
    const stack = [];
    const cycleNodes = new Set();

    function visit(node) {
        if (active.has(node)) {
            const startIndex = stack.indexOf(node);
            if (startIndex >= 0) {
                for (let index = startIndex; index < stack.length; index += 1) {
                    cycleNodes.add(stack[index]);
                }
            }
            return;
        }

        if (visited.has(node)) {
            return;
        }

        visited.add(node);
        active.add(node);
        stack.push(node);

        const next = graph.get(node);
        if (next) {
            visit(next);
        }

        stack.pop();
        active.delete(node);
    }

    for (const node of graph.keys()) {
        visit(node);
    }

    return cycleNodes;
}

function annotateCanonicalSignals(results) {
    const requestedUrlMap = new Map();
    const finalUrlMap = new Map();
    const canonicalGraph = new Map();

    results.forEach((result) => {
        const requestedKey = normalizeComparableUrl(result.url);
        const finalKey = normalizeComparableUrl(result.finalUrl || result.url);

        if (requestedKey) {
            requestedUrlMap.set(requestedKey, result);
        }

        if (finalKey && !finalUrlMap.has(finalKey)) {
            finalUrlMap.set(finalKey, result);
        }
    });

    results.forEach((result) => {
        const finalKey = normalizeComparableUrl(result.finalUrl || result.url);
        const canonicalKey = normalizeComparableUrl(result.canonicalUrl || '');

        if (finalKey && canonicalKey && canonicalKey !== finalKey && finalUrlMap.has(canonicalKey)) {
            canonicalGraph.set(finalKey, canonicalKey);
        }
    });

    const cycleNodes = findCycleNodes(canonicalGraph);

    results.forEach((result) => {
        const issues = new Set();
        const requestedKey = normalizeComparableUrl(result.url);
        const finalKey = normalizeComparableUrl(result.finalUrl || result.url);
        const canonicalKey = normalizeComparableUrl(result.canonicalUrl || '');

        if (result.redirected) {
            issues.add('redirected-url');
        }

        if ((result.redirectCount || 0) > 1) {
            issues.add('redirect-chain');
        }

        if (!canonicalKey) {
            issues.add('missing-canonical');
        }

        if ((result.canonicalCount || 0) > 1) {
            issues.add('multiple-canonicals');
        }

        if (canonicalKey) {
            if (canonicalKey !== finalKey) {
                issues.add('canonical-mismatch');
            }

            if (!sameOrigin(result.canonicalUrl, result.finalUrl || result.url)) {
                issues.add('cross-domain-canonical');
            }

            const canonicalTarget = requestedUrlMap.get(canonicalKey);
            if (canonicalTarget?.redirected) {
                issues.add('canonical-target-redirects');
            }

            if (cycleNodes.has(finalKey)) {
                issues.add('canonical-loop');
            }

            if (requestedKey && canonicalKey === requestedKey && requestedKey !== finalKey && result.redirected) {
                issues.add('canonical-target-redirects');
            }
        }

        result.canonicalIssues = [...issues];
    });

    return results;
}

function getCrawlOptions(options) {
    if (typeof options === 'number') {
        return { maxPages: options, onProgress: null, ga4PropertyId: '', gscSiteUrl: '', authClient: null };
    }

    return {
        maxPages: Number(options?.maxPages || 200),
        onProgress: typeof options?.onProgress === 'function' ? options.onProgress : null,
        ga4PropertyId: typeof options?.ga4PropertyId === 'string' ? options.ga4PropertyId.trim() : '',
        gscSiteUrl: typeof options?.gscSiteUrl === 'string' ? options.gscSiteUrl.trim() : '',
        authClient: options?.authClient || null,
        gscDeep: options?.gscDeep === true,
    };
}

function buildCacheExpiry(ttlMs) {
    return new Date(Date.now() + ttlMs);
}

function isNavigationTimeoutError(error) {
    const message = error?.message || '';
    return message.includes('Navigation timeout') || message.includes('TimeoutError');
}

async function waitForAuditContent(page, options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || CRAWL_CONTENT_WAIT_TIMEOUT_MS));
    const settleDelayMs = Math.max(0, Number(options.settleDelayMs ?? CRAWL_SETTLE_DELAY_MS));
    const bodyTimeout = Math.max(1500, Math.min(timeoutMs, 4000));

    await page.waitForSelector('body', { timeout: bodyTimeout }).catch(() => {});
    await page.waitForSelector(CONTENT_READY_SELECTOR, { timeout: timeoutMs }).catch(() => {});

    // Wait for JS frameworks (React/Next/Vue/Angular) to hydrate their mount point with
    // real content before extraction. Static HTML / PHP pages satisfy this immediately.
    // Best-effort and bounded — never block the crawl if a page never settles.
    await page.waitForFunction(() => {
        const roots = ['#root', '#app', '#__next', '[data-reactroot]', '[ng-version]', 'main', 'article', 'body'];
        for (const selector of roots) {
            const el = document.querySelector(selector);
            if (el && el.childElementCount > 0 && (el.innerText || '').trim().length >= 20) {
                return true;
            }
        }
        return false;
    }, { timeout: timeoutMs, polling: 250 }).catch(() => {});

    if (settleDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, settleDelayMs));
    }
}

async function navigatePageForAudit(page, url, options = {}) {
    const logger = options.logger || console;
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || CRAWL_NAVIGATION_TIMEOUT_MS));
    const contentTimeoutMs = Math.max(1000, Number(options.contentTimeoutMs || CRAWL_CONTENT_WAIT_TIMEOUT_MS));
    const settleDelayMs = Math.max(0, Number(options.settleDelayMs ?? CRAWL_SETTLE_DELAY_MS));

    try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        await waitForAuditContent(page, { timeoutMs: contentTimeoutMs, settleDelayMs });
        return response;
    } catch (error) {
        if (!isNavigationTimeoutError(error)) {
            throw error;
        }

        const currentUrl = typeof page.url === 'function' ? page.url() : '';
        if (!currentUrl || currentUrl === 'about:blank') {
            throw error;
        }

        if (typeof logger.warn === 'function') {
            logger.warn(`Navigation timed out for ${url}. Continuing with the partially loaded document.`);
        }

        await waitForAuditContent(page, {
            timeoutMs: Math.min(contentTimeoutMs, 3000),
            settleDelayMs,
        });
        return null;
    }
}

async function extractAuditPageSnapshot(page) {
    return page.evaluate(() => {
        const title = document.title;
        const description = document.querySelector('meta[name="description"]')?.content || '';
        const metaContent = (selector) => document.querySelector(selector)?.content || '';
        const h1s = Array.from(document.querySelectorAll('h1')).map((el) => el.textContent?.trim() || '').filter(Boolean);
        const bodyText = document.body.innerText || '';
        const wordCount = bodyText.split(/\s+/).filter(Boolean).length;
        const links = Array.from(document.querySelectorAll('a'))
            .map((anchor) => anchor.href)
            .filter((href) => href.startsWith('http'));
        const canonicals = Array.from(document.querySelectorAll('link[rel="canonical"]'))
            .map((element) => element.getAttribute('href') || '')
            .map((href) => (href ? new URL(href, document.baseURI).href : ''))
            .filter(Boolean);
        const jsonLdBlocks = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
            .map((element) => element.textContent || '')
            .filter((text) => text.trim().length > 0);
        const microdataTypes = Array.from(document.querySelectorAll('[itemscope][itemtype]'))
            .map((element) => element.getAttribute('itemtype') || '')
            .filter(Boolean);
        const robotsMeta = [
            document.querySelector('meta[name="robots"]')?.content || '',
            document.querySelector('meta[name="googlebot"]')?.content || '',
        ].filter(Boolean).join(', ');
        const viewport = document.querySelector('meta[name="viewport"]')?.content || '';
        const htmlLang = document.documentElement.getAttribute('lang') || '';
        const hreflangs = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]'))
            .map((element) => ({
                hreflang: element.getAttribute('hreflang') || '',
                href: element.getAttribute('href') ? new URL(element.getAttribute('href'), document.baseURI).href : '',
            }))
            .filter((entry) => entry.hreflang && entry.href);
        const images = Array.from(document.querySelectorAll('img')).map((image) => ({
            src: image.currentSrc || image.src || '',
            alt: image.getAttribute('alt') || '',
            hasAlt: image.hasAttribute('alt') && Boolean((image.getAttribute('alt') || '').trim()),
            hasDimensions: Boolean(image.getAttribute('width') && image.getAttribute('height')),
            loading: image.getAttribute('loading') || '',
        })).filter((image) => image.src);
        const socialMeta = {
            ogTitle: metaContent('meta[property="og:title"]'),
            ogDescription: metaContent('meta[property="og:description"]'),
            ogImage: metaContent('meta[property="og:image"]'),
            twitterCard: metaContent('meta[name="twitter:card"]'),
            twitterTitle: metaContent('meta[name="twitter:title"]'),
            twitterDescription: metaContent('meta[name="twitter:description"]'),
            twitterImage: metaContent('meta[name="twitter:image"]'),
        };
        const appRootEmpty = (() => {
            const mount = ['#root', '#app', '#__next', '[data-reactroot]', '[ng-version]']
                .map((selector) => document.querySelector(selector))
                .find(Boolean);
            if (!mount) {
                return false; // No SPA mount point — not an un-hydrated-shell concern.
            }
            return mount.childElementCount === 0 || (mount.innerText || '').trim().length < 20;
        })();
        const mixedContentUrls = location.protocol === 'https:'
            ? Array.from(document.querySelectorAll('[src], [href]'))
                .map((element) => element.getAttribute('src') || element.getAttribute('href') || '')
                .filter((value) => /^http:\/\//i.test(value))
                .slice(0, 20)
            : [];

        return {
            title,
            description,
            h1s,
            bodyText,
            wordCount,
            links,
            canonicals,
            robotsMeta,
            viewport,
            htmlLang,
            hreflangs,
            images,
            socialMeta,
            mixedContentUrls,
            appRootEmpty,
            structuredData: { jsonLdBlocks, microdataTypes },
        };
    });
}

function shouldRetrySeoExtraction(snapshot = {}) {
    const bodyText = typeof snapshot.bodyText === 'string' ? snapshot.bodyText : '';
    const wordCount = Number(snapshot.wordCount || 0);
    const hasLoadingShellText = /\bloading(?:\.{0,3})?\b/i.test(bodyText);
    const h1Count = Array.isArray(snapshot.h1s) ? snapshot.h1s.length : 0;
    const canonicalCount = Array.isArray(snapshot.canonicals) ? snapshot.canonicals.length : 0;
    const title = typeof snapshot.title === 'string' ? snapshot.title.trim() : '';
    const description = typeof snapshot.description === 'string' ? snapshot.description.trim() : '';
    const hasNoSeoSignals = !title && !description && h1Count === 0 && canonicalCount === 0;
    const thinShellContent = wordCount > 0 && wordCount < 120 && h1Count === 0 && (canonicalCount === 0 || hasLoadingShellText);
    const appRootEmpty = snapshot.appRootEmpty === true;

    return hasLoadingShellText || hasNoSeoSignals || thinShellContent || appRootEmpty;
}

async function extractAuditPageData(page, options = {}) {
    const attempts = Math.max(1, Number(options.attempts || CRAWL_SPA_RETRY_ATTEMPTS));
    const retryIntervalMs = Math.max(0, Number(options.retryIntervalMs || CRAWL_SPA_RETRY_INTERVAL_MS));

    let snapshot = await extractAuditPageSnapshot(page);
    for (let attempt = 1; attempt < attempts && shouldRetrySeoExtraction(snapshot); attempt += 1) {
        if (retryIntervalMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
        }
        snapshot = await extractAuditPageSnapshot(page);
    }

    return {
        title: snapshot.title,
        description: snapshot.description,
        h1s: snapshot.h1s,
        wordCount: snapshot.wordCount,
        links: snapshot.links,
        canonicals: snapshot.canonicals,
        robotsMeta: snapshot.robotsMeta,
        viewport: snapshot.viewport,
        htmlLang: snapshot.htmlLang,
        hreflangs: snapshot.hreflangs,
        images: snapshot.images,
        socialMeta: snapshot.socialMeta,
        mixedContentUrls: snapshot.mixedContentUrls,
        structuredData: snapshot.structuredData,
    };
}

async function reportProgress(onProgress, payload) {
    if (!onProgress) {
        return;
    }

    await onProgress({
        stage: payload.stage,
        completed: payload.completed,
        total: payload.total,
        percent: payload.total > 0 ? Math.min(100, Math.round((payload.completed / payload.total) * 100)) : payload.percent || 0,
        message: payload.message,
        currentUrl: payload.currentUrl || '',
    });
}

async function getCachedLinkCheck(url) {
    const cached = await LinkCheckCache.findOne({
        url,
        expiresAt: { $gt: new Date() },
    }).lean();

    if (!cached) {
        return null;
    }

    return {
        status: cached.status || 0,
        result: cached.result || '',
    };
}

async function setCachedLinkCheck(url, payload) {
    await LinkCheckCache.findOneAndUpdate(
        { url },
        {
            url,
            status: payload.status || 0,
            result: payload.result || '',
            expiresAt: buildCacheExpiry(LINK_CHECK_CACHE_TTL_MS),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

const crawlSite = async (startUrl, options = {}) => {
    const { maxPages, onProgress, ga4PropertyId, gscSiteUrl: selectedGscSiteUrl, authClient, gscDeep } = getCrawlOptions(options);
    console.log('Starting GSC Index Audit + Live Crawl...');
    const auth = authClient || getAuthClient();
    if (!auth) {
        throw new Error('Google Auth missing. Please login again.');
    }

    await reportProgress(onProgress, {
        stage: 'Loading sitemap',
        completed: 0,
        total: 0,
        percent: 0,
        message: 'Loading sitemap URLs',
    });

    const sitemapOptions = {
        logger: console,
        authClient: auth,
        gscSiteUrl: selectedGscSiteUrl || startUrl,
    };
    let urlsToAudit = gscDeep
        ? await fetchSitemapUrlsGscPrimary(startUrl, sitemapOptions)
        : await fetchSitemapUrls(startUrl, sitemapOptions);
    if (urlsToAudit.length > maxPages) {
        urlsToAudit = urlsToAudit.slice(0, maxPages);
    }
    const checkedLinksThisRun = new Map();
    const pendingLinkChecks = new Map();
    let totalUniqueLinkChecks = 0;

    await reportProgress(onProgress, {
        stage: 'Preparing crawl',
        completed: 0,
        total: urlsToAudit.length,
        percent: 0,
        message: `Preparing ${urlsToAudit.length} URLs for crawling`,
    });

    let gscSiteUrl = selectedGscSiteUrl || startUrl;
    if (!selectedGscSiteUrl) {
        try {
            const searchconsole = google.searchconsole({ version: 'v1', auth });
            const sitesRes = await searchconsole.sites.list({});
            const sites = sitesRes.data.siteEntry || [];

            const exactMatch = sites.find((site) => site.siteUrl === startUrl || site.siteUrl === `${startUrl}/`);
            const domainMatch = sites.find((site) => site.siteUrl.includes('sc-domain:') && startUrl.includes(site.siteUrl.replace('sc-domain:', '')));

            if (exactMatch) {
                gscSiteUrl = exactMatch.siteUrl;
            } else if (domainMatch) {
                gscSiteUrl = domainMatch.siteUrl;
            } else if (!gscSiteUrl.endsWith('/') && !gscSiteUrl.includes('sc-domain:')) {
                gscSiteUrl += '/';
            }
        } catch (e) {
            console.error('Failed to list sites:', e.message);
        }
    }

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 90);
    const ymd = (date) => date.toISOString().split('T')[0];

    const pageImpressions = {};
    try {
        const perfData = await gsc.getPerformance(gscSiteUrl, {
            startDate: ymd(start),
            endDate: ymd(end),
            dimensions: ['page'],
            authClient: auth,
        });

        (perfData.rows || []).forEach((row) => {
            const page = row.keys[0];
            if (page) {
                const normalizedPage = normalizeComparableUrl(page);
                pageImpressions[normalizedPage] = (pageImpressions[normalizedPage] || 0) + (row.impressions || 0);
            }
        });
    } catch (e) {
        console.warn('Could not fetch performance data:', e.message);
    }

    let pageViewsByPath = {};
    if (ga4PropertyId) {
        try {
            pageViewsByPath = await ga4.getPageViewMap(ga4PropertyId, {
                startDate: ymd(start),
                endDate: ymd(end),
                authClient: auth,
            });
        } catch (e) {
            console.warn('Could not fetch page-level GA4 data:', e.message);
        }
    }

    const results = [];
    const { launchBrowser } = require('./browser');
    console.log('Launching Headless Browser...');
    const browser = await launchBrowser();
    let processedCount = 0;
    const totalCount = urlsToAudit.length;
    const siteOrigin = new URL(startUrl).origin;

    try {
        const batchSize = CRAWL_BATCH_SIZE;
        for (let i = 0; i < urlsToAudit.length; i += batchSize) {
            const batch = urlsToAudit.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(urlsToAudit.length / batchSize)} (${batch.length} URLs)...`);

            await Promise.all(batch.map(async (url) => {
                const inspectPromise = gsc.inspectUrl(gscSiteUrl, url, { authClient: auth }).then((res) => {
                    if (res.error) return { error: res.error };
                    return res.inspectionResult || {};
                });

                const crawlPromise = (async () => {
                    let pageData = {
                        title: '',
                        description: '',
                        h1s: [],
                        wordCount: 0,
                        links: [],
                        canonicals: [],
                        robotsMeta: '',
                        viewport: '',
                        htmlLang: '',
                        hreflangs: [],
                        images: [],
                        socialMeta: {},
                        mixedContentUrls: [],
                        structuredData: { jsonLdBlocks: [], microdataTypes: [] },
                        finalUrl: url,
                        httpStatus: 0,
                        redirectCount: 0,
                        crawlError: '',
                    };
                    let page = null;
                    try {
                        page = await browser.newPage();
                        await page.setExtraHTTPHeaders({
                            'Accept-Language': 'en-US,en;q=0.9',
                        });
                        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
                        await page.setRequestInterception(true);
                        page.on('request', (req) => {
                            // Keep stylesheets: some frameworks gate content visibility on CSS,
                            // and we need the final rendered layout for accurate extraction.
                            if (['image', 'font', 'media'].includes(req.resourceType())) req.abort();
                            else req.continue();
                        });

                        const response = await navigatePageForAudit(page, url);
                        const finalUrl = page.url();
                        const redirectCount = response?.request()?.redirectChain()?.length || 0;
                        const extracted = await extractAuditPageData(page);
                        pageData = {
                            ...extracted,
                            finalUrl,
                            httpStatus: response?.status?.() || 0,
                            redirectCount,
                        };
                    } catch (err) {
                        console.error(`Crawl failed for ${url}:`, err.message);
                        pageData.crawlError = err.message || 'Crawl failed';
                    } finally {
                        if (page) await page.close();
                    }
                    return pageData;
                })();

                const [inspectionData, pageData] = await Promise.all([inspectPromise, crawlPromise]);
                const internalLinks = uniqueNormalizedLinks(pageData.links, siteOrigin, {
                    includeInternal: true,
                    includeExternal: false,
                });
                const externalLinks = uniqueNormalizedLinks(pageData.links, siteOrigin, {
                    includeInternal: false,
                    includeExternal: true,
                });
                const structuredData = summarizeStructuredData(pageData.structuredData);
                const normalizedRequestedUrl = normalizeComparableUrl(url);
                const normalizedFinalUrl = normalizeComparableUrl(pageData.finalUrl || url);
                const trafficPathKey = normalizeTrafficPathKey(pageData.finalUrl || url) || normalizeTrafficPathKey(url);
                const impressions = pageImpressions[normalizedFinalUrl] || pageImpressions[normalizedRequestedUrl] || 0;
                const ga4Views = pageViewsByPath[trafficPathKey] || 0;

                const contentBlocked = (() => {
                    if (pageData.crawlError) return pageData.crawlError;
                    if (pageData.httpStatus && pageData.httpStatus >= 400) return 'HTTP error';
                    if ((pageData.wordCount || 0) < 20 && !pageData.title && !pageData.description) return 'Empty body';
                    return '';
                })();

                const brokenLinks = [];
                const linkCheckTargets = [...internalLinks, ...externalLinks].slice(0, 40);
                for (const link of linkCheckTargets) {
                    if (checkedLinksThisRun.has(link)) {
                        const cachedResult = checkedLinksThisRun.get(link);
                        if (cachedResult?.status >= 400 || cachedResult?.result === 'fetch-error') {
                            brokenLinks.push(`${link} (${cachedResult.result === 'fetch-error' ? 'fetch-error' : cachedResult.status})`);
                        }
                        continue;
                    }

                    const cachedLink = await getCachedLinkCheck(link);
                    if (cachedLink) {
                        checkedLinksThisRun.set(link, cachedLink);
                        if (cachedLink.status >= 400 || cachedLink.result === 'fetch-error') {
                            brokenLinks.push(`${link} (${cachedLink.result === 'fetch-error' ? 'fetch-error' : cachedLink.status})`);
                        }
                        continue;
                    }

                    if (totalUniqueLinkChecks >= MAX_UNIQUE_LINK_CHECKS_PER_RUN) {
                        continue;
                    }

                    let linkPromise = pendingLinkChecks.get(link);
                    if (!linkPromise) {
                        totalUniqueLinkChecks += 1;
                        linkPromise = (async () => {
                            try {
                                const res = await fetch(link, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
                                const payload = {
                                    status: res.status || 0,
                                    result: String(res.status || 0),
                                };
                                await setCachedLinkCheck(link, payload);
                                return payload;
                            } catch (error) {
                                const payload = { status: 0, result: 'fetch-error' };
                                await setCachedLinkCheck(link, payload);
                                return payload;
                            }
                        })();
                        pendingLinkChecks.set(link, linkPromise);
                    }

                    const checked = await linkPromise;
                    checkedLinksThisRun.set(link, checked);
                    pendingLinkChecks.delete(link);
                    if (checked.status >= 400 || checked.result === 'fetch-error') {
                        brokenLinks.push(`${link} (${checked.result === 'fetch-error' ? 'fetch-error' : checked.status})`);
                    }
                }

                if (inspectionData.error) {
                    results.push({
                        url,
                        finalUrl: pageData.finalUrl || url,
                        httpStatus: pageData.httpStatus || 0,
                        redirected: normalizedFinalUrl !== normalizedRequestedUrl,
                        redirectCount: pageData.redirectCount || 0,
                        status: 'FAIL',
                        coverageState: inspectionData.error,
                        indexingState: 'ERROR',
                        lastCrawlTime: '-',
                        ga4_views: ga4Views,
                        title: pageData.title,
                        description: pageData.description,
                        canonicalUrl: pageData.canonicals?.[0] || '',
                        canonicalCount: pageData.canonicals?.length || 0,
                        canonicalIssues: [],
                        robotsMeta: pageData.robotsMeta || '',
                        viewport: pageData.viewport || '',
                        htmlLang: pageData.htmlLang || '',
                        hreflangs: pageData.hreflangs || [],
                        images: pageData.images || [],
                        socialMeta: pageData.socialMeta || {},
                        mixedContentUrls: pageData.mixedContentUrls || [],
                        structuredData,
                        h1Count: pageData.h1s?.length || 0,
                        h1Text: pageData.h1s?.[0] || '',
                        wordCount: pageData.wordCount || 0,
                        internalLinksOut: internalLinks.length,
                        externalLinksOut: externalLinks.length,
                        internalLinks,
                        incomingLinks: 0,
                        brokenLinks,
                        contentBlocked: Boolean(contentBlocked),
                        contentBlockedReason: contentBlocked || undefined,
                    });
                } else {
                    const indexStatus = inspectionData.indexStatusResult || {};
                    let robotStatus = indexStatus.robotsTxtState || '-';
                    if (robotStatus === 'ROBOTS_TXT_STATE_UNSPECIFIED') robotStatus = 'Not Checked (Queued)';

                    let finalStatus = indexStatus.verdict || 'UNKNOWN';
                    let finalCoverage = formatCoverageState(indexStatus.coverageState);

                    if (impressions > 0) {
                        finalStatus = 'PASS';
                        finalCoverage = 'Indexed & Serving';
                    } else if (finalStatus === 'PASS') {
                        finalCoverage = 'Indexed (Dormant)';
                    }

                    results.push({
                        url,
                        finalUrl: pageData.finalUrl || url,
                        httpStatus: pageData.httpStatus || 0,
                        redirected: normalizedFinalUrl !== normalizedRequestedUrl,
                        redirectCount: pageData.redirectCount || 0,
                        status: finalStatus,
                        coverageState: finalCoverage,
                        indexingState: indexStatus.indexingState || '-',
                        lastCrawlTime: indexStatus.lastCrawlTime ? new Date(indexStatus.lastCrawlTime).toLocaleString() : 'Never',
                        robotStatus,
                        ga4_views: ga4Views,
                        title: pageData.title,
                        description: pageData.description,
                        canonicalUrl: pageData.canonicals?.[0] || '',
                        canonicalCount: pageData.canonicals?.length || 0,
                        canonicalIssues: [],
                        robotsMeta: pageData.robotsMeta || '',
                        viewport: pageData.viewport || '',
                        htmlLang: pageData.htmlLang || '',
                        hreflangs: pageData.hreflangs || [],
                        images: pageData.images || [],
                        socialMeta: pageData.socialMeta || {},
                        mixedContentUrls: pageData.mixedContentUrls || [],
                        structuredData,
                        h1Count: pageData.h1s.length,
                        h1Text: pageData.h1s?.[0] || '',
                        wordCount: pageData.wordCount,
                        internalLinksOut: internalLinks.length,
                        externalLinksOut: externalLinks.length,
                        internalLinks,
                        incomingLinks: 0,
                        brokenLinks,
                        contentBlocked: Boolean(contentBlocked),
                        contentBlockedReason: contentBlocked || undefined,
                    });
                }

                processedCount += 1;
                await reportProgress(onProgress, {
                    stage: 'Crawling pages',
                    completed: processedCount,
                    total: totalCount,
                    message: `Processed ${processedCount} of ${totalCount} pages`,
                    currentUrl: url,
                });
            }));

            if (i + batchSize < urlsToAudit.length) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }

        await reportProgress(onProgress, {
            stage: 'Analyzing internal links',
            completed: totalCount,
            total: totalCount,
            percent: 95,
            message: 'Building internal link graph',
        });

        const urlInLinks = {};
        const knownUrls = new Map(results.map((result) => [normalizeComparableUrl(result.url), result.url]));

        results.forEach((page) => {
            (page.internalLinks || []).forEach((link) => {
                const matchedUrl = knownUrls.get(normalizeComparableUrl(link));
                if (matchedUrl) {
                    urlInLinks[matchedUrl] = (urlInLinks[matchedUrl] || 0) + 1;
                }
            });
        });

        results.forEach((page) => {
            page.incomingLinks = urlInLinks[page.url] || 0;
        });

        annotateCanonicalSignals(results);
        annotateTechnicalIssues(results);
    } finally {
        // On Windows, Chrome can still hold a lock on its temp profile when close() tries
        // to unlink it (EBUSY on first_party_sets.db). Don't let cleanup fail an audit whose
        // results are already computed.
        try {
            await browser.close();
        } catch (closeError) {
            console.warn('Browser close failed during cleanup:', closeError.message);
        }
    }

    results.sort((a, b) => a.url.localeCompare(b.url));

    await reportProgress(onProgress, {
        stage: 'Completed',
        completed: totalCount,
        total: totalCount,
        percent: 100,
        message: `Completed audit for ${totalCount} pages`,
    });

    return results;
};

const formatCoverageState = (state) => {
    if (!state) return 'Unknown';
    const map = {
        SUBMITTED_AND_INDEXED: 'Submitted and indexed',
        CRAWLED_NOT_INDEXED: 'Crawled - currently not indexed',
        DISCOVERED_NOT_INDEXED: 'Discovered - currently not indexed',
        INDEXING_STATE_UNSPECIFIED: 'Unknown',
        BLOCKED_BY_ROBOTS_TXT: 'Blocked by robots.txt',
        NOT_FOUND: 'Page not found (404)',
        SERVER_ERROR: 'Server error (5xx)',
        REDIRECT_ERROR: 'Redirect error',
        BLOCKED_4XX: 'Blocked (4xx)',
        DUPLICATE_WITHOUT_USER_SELECTED_CANONICAL: 'Duplicate without user-selected canonical',
        DUPLICATE_GOOGLE_CHOSE_DIFFERENT_CANONICAL: 'Duplicate, Google chose different canonical than user',
        SOFT_404: 'Soft 404',
    };
    return map[state] || state;
};

module.exports = {
    crawlSite,
    __internal: {
        annotateCanonicalSignals,
        extractAuditPageData,
        extractAuditPageSnapshot,
        findCycleNodes,
        isNavigationTimeoutError,
        navigatePageForAudit,
        normalizeComparableUrl,
        normalizeTrafficPathKey,
        isInternalUrl,
        sameOrigin,
        shouldRetrySeoExtraction,
        uniqueNormalizedLinks,
        waitForAuditContent,
    },
};
