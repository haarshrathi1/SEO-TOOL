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
