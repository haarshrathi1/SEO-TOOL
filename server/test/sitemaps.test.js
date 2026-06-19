const test = require('node:test');
const assert = require('node:assert/strict');

const sitemaps = require('../sitemaps');

function createLogger() {
    return {
        log() {},
        warn() {},
        error() {},
    };
}

test('fetchSitemapUrls follows nested sitemap indexes and returns page URLs', async () => {
    const responses = {
        'https://example.com/sitemap.xml': `
            <sitemapindex>
                <sitemap><loc>https://example.com/post-sitemap.xml</loc></sitemap>
                <sitemap><loc>https://example.com/page-sitemap.xml</loc></sitemap>
            </sitemapindex>
        `,
        'https://example.com/post-sitemap.xml': `
            <urlset>
                <url><loc>https://example.com/blog/post-1</loc></url>
            </urlset>
        `,
        'https://example.com/page-sitemap.xml': `
            <urlset>
                <url><loc>https://example.com/about</loc></url>
            </urlset>
        `,
    };

    const urls = await sitemaps.fetchSitemapUrls('https://example.com/', {
        axiosClient: {
            get: async (url) => {
                if (!(url in responses)) {
                    throw new Error(`Unexpected sitemap URL: ${url}`);
                }
                return { data: responses[url] };
            },
        },
        logger: createLogger(),
    });

    assert.deepEqual(urls.sort(), [
        'https://example.com/about',
        'https://example.com/blog/post-1',
    ]);
});

test('fetchSitemapUrls falls back to the site URL when no page URLs are discovered', async () => {
    const urls = await sitemaps.fetchSitemapUrls('https://example.com/', {
        axiosClient: {
            get: async () => ({ data: '<sitemapindex></sitemapindex>' }),
        },
        logger: createLogger(),
    });

    assert.deepEqual(urls, ['https://example.com/']);
});

test('fetchSitemapUrls resolves relative links and skips cross-origin URLs', async () => {
    const responses = {
        'https://example.com/sitemap.xml': `
            <sitemapindex>
                <sitemap><loc>/post-sitemap.xml</loc></sitemap>
                <sitemap><loc>https://evil.example.net/trap.xml</loc></sitemap>
                <sitemap><loc>/about</loc></sitemap>
            </sitemapindex>
        `,
        'https://example.com/post-sitemap.xml': `
            <urlset>
                <url><loc>/blog/post-1</loc></url>
                <url><loc>https://evil.example.net/phishing</loc></url>
            </urlset>
        `,
    };

    const urls = await sitemaps.fetchSitemapUrls('https://example.com/', {
        axiosClient: {
            get: async (url) => {
                if (!(url in responses)) {
                    throw new Error(`Unexpected sitemap URL: ${url}`);
                }
                return { data: responses[url] };
            },
        },
        logger: createLogger(),
    });

    assert.deepEqual(urls.sort(), [
        'https://example.com/about',
        'https://example.com/blog/post-1',
    ]);
});
