const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_MAX_DEPTH = 6;

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

async function fetchSitemapUrls(siteUrl, options = {}) {
    const normalizedSiteUrl = normalizeUrl(siteUrl);
    if (!normalizedSiteUrl) {
        return [];
    }

    const sitemapUrl = new URL('/sitemap.xml', normalizedSiteUrl).href;
    const runtimeOptions = {
        axiosClient: options.axiosClient || axios,
        timeoutMs: options.timeoutMs || DEFAULT_TIMEOUT_MS,
        maxDepth: options.maxDepth || DEFAULT_MAX_DEPTH,
        logger: options.logger || console,
        siteUrl: normalizedSiteUrl,
    };
    const state = {
        seenSitemaps: new Set(),
        pageUrls: new Set(),
    };

    await collectSitemapPageUrls(sitemapUrl, state, runtimeOptions, 0);

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
    __internal: {
        collectSitemapPageUrls,
        extractSitemapLocs,
        isSitemapXmlUrl,
        isSameOrigin,
        normalizeUrl,
    },
};
