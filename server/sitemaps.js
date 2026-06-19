const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const { google } = require('googleapis');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_DEPTH = 6;

// Use a realistic User-Agent so servers don't 403 headless requests.
const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (compatible; ClimbSEO/1.0; +https://climbseo.com/bot)';

// Common sitemap paths tried in order when robots.txt yields nothing.
const FALLBACK_SITEMAP_PATHS = [
    '/sitemap.xml',
    '/sitemap_index.xml',
    '/sitemap-index.xml',
    '/sitemaps/sitemap.xml',
    '/wp-sitemap.xml',
];

function normalizeUrl(value, baseUrl = '') {
    const raw = String(value || '').trim();
    if (!raw) {
        return '';
    }

    try {
        if (baseUrl) {
            return new URL(raw, baseUrl).href;
        }
        return new URL(raw).href;
    } catch {
        if (!baseUrl && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
            try {
                return new URL(`https://${raw}`).href;
            } catch {
                return '';
            }
        }
        return '';
    }
}

function isSameOrigin(left, right) {
    try {
        return new URL(left).origin.toLowerCase() === new URL(right).origin.toLowerCase();
    } catch {
        return false;
    }
}

function extractSitemapLocs(xml) {
    const $ = cheerio.load(xml || '', { xmlMode: true });
    const urls = [];

    $('loc').each((_, el) => {
        const url = $(el).text().trim();
        if (url) {
            urls.push(url);
        }
    });

    return urls;
}

function isSitemapXmlUrl(url) {
    if (!url) {
        return false;
    }

    try {
        const pathname = new URL(url).pathname.toLowerCase();
        return pathname.endsWith('.xml') || pathname.endsWith('.xml.gz');
    } catch {
        return /\.xml(?:\.gz)?(?:$|\?)/i.test(String(url));
    }
}

async function collectSitemapPageUrls(sitemapUrl, state, options, depth = 0) {
    const maxDepth = Number(options.maxDepth || DEFAULT_MAX_DEPTH);
    const normalizedSitemapUrl = normalizeUrl(sitemapUrl);

    if (!normalizedSitemapUrl || state.seenSitemaps.has(normalizedSitemapUrl)) {
        return;
    }

    if (options.siteUrl && !isSameOrigin(normalizedSitemapUrl, options.siteUrl)) {
        options.logger?.warn?.(`Skipping cross-origin sitemap: ${normalizedSitemapUrl}`);
        return;
    }

    state.seenSitemaps.add(normalizedSitemapUrl);

    if (depth > maxDepth) {
        options.logger?.warn?.(`Skipping nested sitemap beyond depth ${maxDepth}: ${normalizedSitemapUrl}`);
        return;
    }

    try {
        const response = await options.axiosClient.get(normalizedSitemapUrl, {
            timeout: Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
            headers: { 'User-Agent': options.userAgent || DEFAULT_USER_AGENT },
        });
        const locs = extractSitemapLocs(response.data);

        for (const loc of locs) {
            const normalizedLoc = normalizeUrl(loc, normalizedSitemapUrl);
            if (!normalizedLoc) {
                continue;
            }

            if (options.siteUrl && !isSameOrigin(normalizedLoc, options.siteUrl)) {
                options.logger?.warn?.(`Skipping cross-origin URL from sitemap: ${normalizedLoc}`);
                continue;
            }

            if (isSitemapXmlUrl(normalizedLoc)) {
                await collectSitemapPageUrls(normalizedLoc, state, options, depth + 1);
                continue;
            }

            state.pageUrls.add(normalizedLoc);
        }
    } catch (error) {
        options.logger?.error?.(`Failed to fetch sitemap ${normalizedSitemapUrl}: ${error.message}`);
    }
}

/**
 * Read robots.txt and return any Sitemap: directive URLs declared there.
 */
async function fetchSitemapUrlsFromRobots(siteUrl, runtimeOptions) {
    const robotsUrl = new URL('/robots.txt', siteUrl).href;
    try {
        const res = await runtimeOptions.axiosClient.get(robotsUrl, {
            timeout: Number(runtimeOptions.timeoutMs),
            headers: { 'User-Agent': runtimeOptions.userAgent || DEFAULT_USER_AGENT },
        });
        const text = typeof res.data === 'string' ? res.data : '';
        const found = [];
        for (const line of text.split('\n')) {
            const match = line.match(/^\s*Sitemap:\s*(.+)/i);
            if (match) {
                const url = match[1].trim();
                if (url) found.push(url);
            }
        }
        return found;
    } catch {
        return [];
    }
}

/**
 * Query GSC Search Analytics for all pages with any impressions in the last 90 days.
 * Returns up to 25 000 unique page URLs that Google has indexed for this property.
 * Used as a fallback when every HTTP sitemap fetch is blocked (e.g. 403).
 */
async function fetchUrlsFromGsc(gscSiteUrl, authClient, logger) {
    try {
        const sc = google.searchconsole({ version: 'v1', auth: authClient });
        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 90);
        const fmt = (d) => d.toISOString().slice(0, 10);

        const res = await sc.searchanalytics.query({
            siteUrl: gscSiteUrl,
            requestBody: {
                startDate: fmt(startDate),
                endDate: fmt(endDate),
                dimensions: ['page'],
                rowLimit: 25000,
                startRow: 0,
            },
        });

        const rows = res.data.rows || [];
        const urls = rows
            .map((r) => (Array.isArray(r.keys) ? r.keys[0] : ''))
            .filter(Boolean);

        logger?.log?.(`GSC fallback: found ${urls.length} URLs from Search Analytics`);
        return urls;
    } catch (error) {
        logger?.warn?.(`GSC fallback failed: ${error.message}`);
        return [];
    }
}

/**
 * GSC-first URL discovery for large sites (500+ pages / multiple sitemaps).
 * 1. Queries GSC Search Analytics to get all indexed page URLs.
 * 2. Fetches every registered sitemap from GSC sitemaps.list to catch pages
 *    that have impressions too recent to appear in Search Analytics yet.
 * 3. Merges + deduplicates, filtered to the same origin as siteUrl.
 */
async function fetchSitemapUrlsGscPrimary(siteUrl, options = {}) {
    const normalizedSiteUrl = normalizeUrl(siteUrl);
    if (!normalizedSiteUrl || !options.authClient || !options.gscSiteUrl) {
        return [];
    }

    const logger = options.logger || console;
    const runtimeOptions = {
        axiosClient: options.axiosClient || axios,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        maxDepth: options.maxDepth || DEFAULT_MAX_DEPTH,
        logger,
        userAgent: options.userAgent || DEFAULT_USER_AGENT,
        siteUrl: normalizedSiteUrl,
    };
    const pageUrls = new Set();

    // Step 1 — Search Analytics: all URLs with any impression in last 90 days.
    logger.log?.('GSC Deep: querying Search Analytics for indexed pages…');
    const analyticsUrls = await fetchUrlsFromGsc(options.gscSiteUrl, options.authClient, logger);
    for (const url of analyticsUrls) {
        if (isSameOrigin(url, normalizedSiteUrl)) pageUrls.add(url);
    }
    logger.log?.(`GSC Deep: ${pageUrls.size} URLs from Search Analytics`);

    // Step 2 — Registered sitemaps: fetch each sitemap XML declared in GSC.
    //          Some sitemaps are hosted on CDNs and accessible even when the
    //          main site blocks direct HTTP requests (403).
    try {
        const sc = google.searchconsole({ version: 'v1', auth: options.authClient });
        const res = await sc.sitemaps.list({ siteUrl: options.gscSiteUrl });
        const registered = (res.data.sitemap || []).map((s) => s.path).filter(Boolean);
        logger.log?.(`GSC Deep: found ${registered.length} registered sitemap(s) — fetching…`);

        const sitemapState = { seenSitemaps: new Set(), pageUrls: new Set() };
        for (const sitemapUrl of registered) {
            await collectSitemapPageUrls(sitemapUrl, sitemapState, runtimeOptions, 0);
        }
        let added = 0;
        for (const url of sitemapState.pageUrls) {
            if (isSameOrigin(url, normalizedSiteUrl) && !pageUrls.has(url)) {
                pageUrls.add(url);
                added++;
            }
        }
        if (added > 0) logger.log?.(`GSC Deep: +${added} extra URLs from registered sitemaps`);
    } catch (err) {
        logger.warn?.(`GSC Deep: sitemaps.list failed (${err.message}), continuing with Search Analytics URLs only`);
    }

    const urls = [...pageUrls];
    logger.log?.(`GSC Deep: ${urls.length} total unique URLs ready for crawl`);
    return urls.length > 0 ? urls : [normalizedSiteUrl];
}

async function fetchSitemapUrls(siteUrl, options = {}) {
    const normalizedSiteUrl = normalizeUrl(siteUrl);
    if (!normalizedSiteUrl) {
        return [];
    }

    const runtimeOptions = {
        axiosClient: options.axiosClient || axios,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        maxDepth: options.maxDepth || DEFAULT_MAX_DEPTH,
        logger: options.logger || console,
        userAgent: options.userAgent || DEFAULT_USER_AGENT,
        siteUrl: normalizedSiteUrl,
    };
    const state = {
        seenSitemaps: new Set(),
        pageUrls: new Set(),
    };

    // 1. Check robots.txt for Sitemap: directives first.
    const robotsSitemaps = await fetchSitemapUrlsFromRobots(normalizedSiteUrl, runtimeOptions);
    if (robotsSitemaps.length > 0) {
        runtimeOptions.logger?.log?.(`Found ${robotsSitemaps.length} sitemap(s) in robots.txt`);
        for (const url of robotsSitemaps) {
            await collectSitemapPageUrls(url, state, runtimeOptions, 0);
        }
    }

    // 2. If robots.txt yielded no pages, try common sitemap paths in order.
    if (state.pageUrls.size === 0) {
        for (const path of FALLBACK_SITEMAP_PATHS) {
            const candidate = new URL(path, normalizedSiteUrl).href;
            await collectSitemapPageUrls(candidate, state, runtimeOptions, 0);
            if (state.pageUrls.size > 0) break;
        }
    }

    // 3. If all HTTP sitemap fetches were blocked (e.g. 403), fall back to GSC
    //    Search Analytics which returns every URL Google has indexed — no HTTP
    //    request to the site needed.
    if (state.pageUrls.size === 0 && options.authClient && options.gscSiteUrl) {
        runtimeOptions.logger?.warn?.(`All sitemap fetches failed for ${normalizedSiteUrl}. Trying GSC Search Analytics fallback.`);
        const gscUrls = await fetchUrlsFromGsc(options.gscSiteUrl, options.authClient, runtimeOptions.logger);
        for (const url of gscUrls) {
            if (isSameOrigin(url, normalizedSiteUrl)) {
                state.pageUrls.add(url);
            }
        }
    }

    const urls = [...state.pageUrls];
    if (urls.length > 0) {
        runtimeOptions.logger?.log?.(`Found ${urls.length} URLs across sitemap set.`);
        return urls;
    }

    runtimeOptions.logger?.warn?.(`No page URLs found in sitemap set for ${normalizedSiteUrl}. Falling back to the start URL.`);
    return [normalizedSiteUrl];
}

module.exports = {
    fetchSitemapUrls,
    fetchSitemapUrlsGscPrimary,
    __internal: {
        collectSitemapPageUrls,
        fetchSitemapUrlsFromRobots,
        fetchSitemapUrlsGscPrimary,
        fetchUrlsFromGsc,
        extractSitemapLocs,
        isSitemapXmlUrl,
        isSameOrigin,
        normalizeUrl,
    },
};
