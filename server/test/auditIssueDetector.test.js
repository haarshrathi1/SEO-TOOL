const test = require('node:test');
const assert = require('node:assert/strict');

const { collectTechnicalIssues, annotateTechnicalIssues } = require('../auditIssueDetector');
const auditJobs = require('../auditJobs');

test('collectTechnicalIssues detects crawlability, metadata, indexation, and performance issues', () => {
    const issues = collectTechnicalIssues({
        url: 'https://example.com/broken',
        status: 'FAIL',
        coverageState: 'Blocked by robots.txt',
        indexingState: 'BLOCKED_BY_ROBOTS_TXT',
        robotStatus: 'BLOCKED',
        httpStatus: 500,
        title: '',
        description: '',
        h1Count: 0,
        wordCount: 12,
        canonicalIssues: ['missing-canonical'],
        brokenLinks: ['https://example.com/missing (404)'],
        psi_data: {
            mobile: { score: 42, lcp: '5.1 s', cls: '0.31', inp: '610 ms' },
            desktop: { score: 88, lcp: '2.7 s', cls: '0.05', inp: '120 ms' },
        },
    });

    const ids = issues.map((issue) => issue.id);
    assert.ok(ids.includes('http-5xx'));
    assert.ok(ids.includes('not-indexed'));
    assert.ok(ids.includes('robots-blocked'));
    assert.ok(ids.includes('missing-canonical'));
    assert.ok(ids.includes('broken-link'));
    assert.ok(ids.includes('slow-mobile'));
    assert.ok(ids.includes('mobile-lcp-poor'));
    assert.ok(ids.includes('mobile-cls-poor'));
    assert.ok(ids.includes('mobile-inp-poor'));
});

test('annotateTechnicalIssues detects duplicate titles across audited pages', () => {
    const results = annotateTechnicalIssues([
        {
            url: 'https://example.com/a',
            status: 'PASS',
            title: 'Shared SEO Title for Testing',
            description: 'A unique description that is long enough for the detector.',
            h1Count: 1,
            wordCount: 400,
            viewport: 'width=device-width, initial-scale=1',
            htmlLang: 'en',
        },
        {
            url: 'https://example.com/b',
            status: 'PASS',
            title: 'Shared SEO Title for Testing',
            description: 'Another unique description that is long enough for the detector.',
            h1Count: 1,
            wordCount: 400,
            viewport: 'width=device-width, initial-scale=1',
            htmlLang: 'en',
        },
    ]);

    assert.ok(results[0].technicalIssues.some((issue) => issue.id === 'duplicate-title'));
    assert.ok(results[1].technicalIssues.some((issue) => issue.id === 'duplicate-title'));
});

test('collectTechnicalIssues detects image, social, hreflang, nofollow, and mixed-content issues', () => {
    const issues = collectTechnicalIssues({
        url: 'https://example.com/page',
        status: 'PASS',
        title: 'A useful page title for testing',
        description: 'A useful meta description that is long enough for testing the detector.',
        h1Count: 1,
        h1Text: 'A useful page title for testing',
        wordCount: 500,
        viewport: 'width=device-width, initial-scale=1',
        htmlLang: 'en',
        robotsMeta: 'index, nofollow',
        images: [
            { src: 'https://example.com/a.jpg', alt: '', hasAlt: false, hasDimensions: false },
        ],
        socialMeta: {
            ogTitle: '',
            ogDescription: '',
            ogImage: '',
            twitterCard: '',
            twitterTitle: '',
            twitterDescription: '',
            twitterImage: '',
        },
        hreflangs: [{ hreflang: 'english-us', href: 'https://example.com/en' }],
        mixedContentUrls: ['http://example.com/insecure.js'],
    });

    const ids = issues.map((issue) => issue.id);
    assert.ok(ids.includes('meta-nofollow'));
    assert.ok(ids.includes('title-h1-duplicate'));
    assert.ok(ids.includes('image-alt-missing'));
    assert.ok(ids.includes('image-dimensions-missing'));
    assert.ok(ids.includes('open-graph-missing'));
    assert.ok(ids.includes('twitter-card-missing'));
    assert.ok(ids.includes('hreflang-invalid'));
    assert.ok(ids.includes('mixed-content'));
});

test('buildAuditArtifacts persists normalized technical issue severities', () => {
    const { summary, issues } = auditJobs.__internal.buildAuditArtifacts([
        {
            url: 'https://example.com/a',
            status: 'PASS',
            title: '',
            description: '',
            h1Count: 0,
            wordCount: 20,
            canonicalIssues: ['missing-canonical'],
            brokenLinks: ['https://example.com/missing (404)'],
        },
    ]);

    assert.equal(summary.crawledUrls, 1);
    assert.ok(summary.issuesBySeverity.high >= 2);
    assert.ok(issues.some((issue) => issue.metadata.issueId === 'missing-title'));
    assert.ok(issues.some((issue) => issue.metadata.issueId === 'broken-link'));
});
