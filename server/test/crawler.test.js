const test = require('node:test');
const assert = require('node:assert/strict');

const crawler = require('../crawler');

test('crawler normalizes comparable URLs consistently', () => {
    assert.equal(
        crawler.__internal.normalizeComparableUrl('https://Example.com/about/#team'),
        'https://example.com/about'
    );

    assert.equal(
        crawler.__internal.normalizeComparableUrl('https://example.com/'),
        'https://example.com/'
    );
});

test('crawler identifies same-origin URLs as internal', () => {
    assert.equal(
        crawler.__internal.isInternalUrl('https://example.com/pricing', 'https://example.com/'),
        true
    );

    assert.equal(
        crawler.__internal.isInternalUrl('https://cdn.example.com/app.js', 'https://example.com/'),
        false
    );
});

test('crawler keeps unique normalized internal links only', () => {
    assert.deepEqual(
        crawler.__internal.uniqueNormalizedLinks([
            'https://example.com/about',
            'https://example.com/about/',
            'https://example.com/about#team',
            'https://other.com/',
        ], 'https://example.com/'),
        ['https://example.com/about']
    );
});

test('crawler marks canonical loops and redirect targets', () => {
    const results = crawler.__internal.annotateCanonicalSignals([
        {
            url: 'https://example.com/a',
            finalUrl: 'https://example.com/a',
            redirected: false,
            redirectCount: 0,
            canonicalUrl: 'https://example.com/b',
            canonicalCount: 1,
        },
        {
            url: 'https://example.com/b',
            finalUrl: 'https://example.com/b',
            redirected: false,
            redirectCount: 0,
            canonicalUrl: 'https://example.com/a',
            canonicalCount: 1,
        },
        {
            url: 'https://example.com/source',
            finalUrl: 'https://example.com/destination',
            redirected: true,
            redirectCount: 1,
            canonicalUrl: 'https://example.com/source',
            canonicalCount: 1,
        },
    ]);

    assert.deepEqual(results[0].canonicalIssues.sort(), ['canonical-loop', 'canonical-mismatch']);
    assert.deepEqual(results[1].canonicalIssues.sort(), ['canonical-loop', 'canonical-mismatch']);
    assert.deepEqual(results[2].canonicalIssues.sort(), ['canonical-mismatch', 'canonical-target-redirects', 'redirected-url']);
});

test('crawler marks missing, multiple, and cross-domain canonicals', () => {
    const results = crawler.__internal.annotateCanonicalSignals([
        {
            url: 'https://example.com/a',
            finalUrl: 'https://example.com/a',
            redirected: false,
            redirectCount: 0,
            canonicalUrl: '',
            canonicalCount: 0,
        },
        {
            url: 'https://example.com/b',
            finalUrl: 'https://example.com/b',
            redirected: false,
            redirectCount: 0,
            canonicalUrl: 'https://other.com/b',
            canonicalCount: 2,
        },
    ]);

    assert.deepEqual(results[0].canonicalIssues, ['missing-canonical']);
    assert.deepEqual(results[1].canonicalIssues.sort(), ['canonical-mismatch', 'cross-domain-canonical', 'multiple-canonicals']);
});

test('crawler treats navigation timeout messages as retriable', () => {
    assert.equal(
        crawler.__internal.isNavigationTimeoutError(new Error('Navigation timeout of 30000 ms exceeded')),
        true
    );

    assert.equal(
        crawler.__internal.isNavigationTimeoutError(new Error('net::ERR_CONNECTION_RESET')),
        false
    );
});

test('crawler falls back to the partially loaded document after navigation timeout', async () => {
    const warnings = [];
    const waitCalls = [];
    const page = {
        goto: async () => {
            throw new Error('Navigation timeout of 30000 ms exceeded');
        },
        url: () => 'https://example.com/about',
        waitForSelector: async (selector, options) => {
            waitCalls.push({ selector, timeout: options.timeout });
        },
    };

    const response = await crawler.__internal.navigatePageForAudit(page, 'https://example.com/about', {
        logger: { warn: (message) => warnings.push(message) },
        timeoutMs: 1000,
        contentTimeoutMs: 1000,
        settleDelayMs: 0,
    });

    assert.equal(response, null);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /Continuing with the partially loaded document/);
    assert.deepEqual(waitCalls, [
        { selector: 'body', timeout: 1500 },
        { selector: 'body, title, h1, meta[name="description"], main, article', timeout: 1000 },
    ]);
});

test('crawler rethrows navigation timeout when no document has loaded yet', async () => {
    const page = {
        goto: async () => {
            throw new Error('Navigation timeout of 30000 ms exceeded');
        },
        url: () => 'about:blank',
        waitForSelector: async () => {},
    };

    await assert.rejects(
        crawler.__internal.navigatePageForAudit(page, 'https://example.com/about', {
            timeoutMs: 1000,
            contentTimeoutMs: 1000,
            settleDelayMs: 0,
        }),
        /Navigation timeout/
    );
});

test('crawler retries extraction when the page still looks like a loading shell', () => {
    assert.equal(
        crawler.__internal.shouldRetrySeoExtraction({
            title: 'Blog | FleetFlow',
            description: 'FleetFlow Blog',
            h1s: [],
            canonicals: ['https://fleetflow.hyvikk.com/blog/10-must-have-features-taxi-management-system'],
            wordCount: 83,
            bodyText: 'Solutions Features Pricing Loading...',
        }),
        true
    );

    assert.equal(
        crawler.__internal.shouldRetrySeoExtraction({
            title: '10 Essential Admin Panel Features for Taxi Management (2026)',
            description: 'Stop paying for bloated software.',
            h1s: ['10 Must-Have Admin Features for Taxi Management Systems'],
            canonicals: ['https://fleetflow.hyvikk.com/blog/10-must-have-features-taxi-management-system'],
            wordCount: 1249,
            bodyText: 'Back to Blog 10 Must-Have Admin Features for Taxi Management Systems',
        }),
        false
    );
});
