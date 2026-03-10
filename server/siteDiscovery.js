const axios = require('axios');
const cheerio = require('cheerio');

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (compatible; SEOIntelBot/1.0; +https://seotool.harshrathi.com)',
    'Accept': 'application/xml, text/xml, text/plain;q=0.9, */*;q=0.8',
};

function stripWww(hostname = '') {
    return hostname.toLowerCase().replace(/^www\./, '');
}

function normalizeUrl(input, options = {}) {
    const { keepQuery = false } = options;

    try {
        const url = new URL(input);

        if (!/^https?:$/.test(url.protocol)) {
            return '';
        }

        url.hash = '';
        if (!keepQuery) {
            url.search = '';
        }

        url.hostname = url.hostname.toLowerCase();

        if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) {
            url.port = '';
        }

        let pathname = url.pathname.replace(/\/{2,}/g, '/');
        pathname = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
        url.pathname = pathname || '/';

        return url.toString();
    } catch {
        return '';
    }
}

function isInternalUrl(candidate, siteUrl) {
    try {
        const candidateHost = stripWww(new URL(candidate).hostname);
        const siteHost = stripWww(new URL(siteUrl).hostname);
        return candidateHost === siteHost;
    } catch {
        return false;
    }
}

async function fetchText(url, timeout = 10000) {
    const response = await axios.get(url, {
        timeout,
        headers: DEFAULT_HEADERS,
        responseType: 'text',
        maxRedirects: 5,
        validateStatus: (status) => status >= 200 && status < 400,
    });

    return response.data || '';
}

async function getSitemapSeeds(siteUrl) {
    const seeds = new Set([new URL('/sitemap.xml', siteUrl).href]);

    try {
        const robotsUrl = new URL('/robots.txt', siteUrl).href;
        const robotsText = await fetchText(robotsUrl, 5000);
        robotsText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .forEach((line) => {
                const match = line.match(/^sitemap:\s*(.+)$/i);
                if (match?.[1]) {
                    seeds.add(new URL(match[1].trim(), siteUrl).href);
                }
            });
    } catch {
        // Ignore robots.txt fetch failures and fall back to /sitemap.xml.
    }

    return [...seeds];
}

async function discoverSitemapUrls(siteUrl, options = {}) {
    const maxUrls = Math.max(1, Number(options.maxUrls || 500));
    const sitemapQueue = await getSitemapSeeds(siteUrl);
    const visitedSitemaps = new Set();
    const discoveredUrls = new Set();

    while (sitemapQueue.length > 0 && discoveredUrls.size < maxUrls) {
        const sitemapUrl = sitemapQueue.shift();
        if (!sitemapUrl || visitedSitemaps.has(sitemapUrl)) {
            continue;
        }

        visitedSitemaps.add(sitemapUrl);

        try {
            const xml = await fetchText(sitemapUrl, 10000);
            const $ = cheerio.load(xml, { xmlMode: true });

            const sitemapLocs = $('sitemap > loc, sitemapindex > sitemap > loc')
                .toArray()
                .map((el) => new URL($(el).text().trim(), sitemapUrl).href)
                .filter(Boolean);

            sitemapLocs.forEach((childUrl) => {
                if (!visitedSitemaps.has(childUrl)) {
                    sitemapQueue.push(childUrl);
                }
            });

            const pageLocs = $('url > loc, urlset > url > loc')
                .toArray()
                .map((el) => normalizeUrl(new URL($(el).text().trim(), sitemapUrl).href))
                .filter(Boolean);

            pageLocs.forEach((pageUrl) => {
                if (discoveredUrls.size < maxUrls) {
                    discoveredUrls.add(pageUrl);
                }
            });

            if (!sitemapLocs.length && !pageLocs.length) {
                const fallbackLocs = $('loc')
                    .toArray()
                    .map((el) => new URL($(el).text().trim(), sitemapUrl).href)
                    .filter(Boolean);

                fallbackLocs.forEach((loc) => {
                    if (/\.xml($|\?)/i.test(loc)) {
                        if (!visitedSitemaps.has(loc)) {
                            sitemapQueue.push(loc);
                        }
                        return;
                    }

                    const normalized = normalizeUrl(loc);
                    if (normalized && discoveredUrls.size < maxUrls) {
                        discoveredUrls.add(normalized);
                    }
                });
            }
        } catch (error) {
            console.error(`Failed to fetch sitemap ${sitemapUrl}:`, error.message);
        }
    }

    if (!discoveredUrls.size) {
        const normalizedSiteUrl = normalizeUrl(siteUrl);
        return normalizedSiteUrl ? [normalizedSiteUrl] : [siteUrl];
    }

    return [...discoveredUrls];
}

module.exports = {
    discoverSitemapUrls,
    isInternalUrl,
    normalizeUrl,
    stripWww,
};
