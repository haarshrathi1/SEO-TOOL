const test = require('node:test');
const assert = require('node:assert/strict');

const structuredData = require('../structuredData');

test('structured data summary parses graph entities and rich result types', () => {
    const summary = structuredData.summarizeStructuredData({
        jsonLdBlocks: [
            JSON.stringify({
                '@context': 'https://schema.org',
                '@graph': [
                    {
                        '@type': 'BreadcrumbList',
                        itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home' }],
                    },
                    {
                        '@type': 'Article',
                        headline: 'Example title',
                        author: { '@type': 'Person', name: 'A Writer' },
                        datePublished: '2026-03-01',
                    },
                ],
            }),
        ],
        microdataTypes: ['https://schema.org/Product'],
    });

    assert.equal(summary.totalItems, 3);
    assert.deepEqual(summary.richResultTypes, ['Article', 'BreadcrumbList', 'Product']);
    assert.equal(summary.parseErrors.length, 0);
    assert.equal(summary.issues.length, 0);
    assert.equal(summary.valid, true);
});

test('structured data summary flags parse errors and missing required fields', () => {
    const summary = structuredData.summarizeStructuredData({
        jsonLdBlocks: [
            '{not valid json}',
            JSON.stringify({
                '@context': 'https://schema.org',
                '@type': 'Product',
            }),
        ],
        microdataTypes: [],
    });

    assert.deepEqual(summary.parseErrors, ['Invalid JSON-LD block 1']);
    assert.equal(summary.issues.some((issue) => issue.code === 'product-missing-name'), true);
    assert.equal(summary.issues.some((issue) => issue.code === 'product-missing-commerce-data'), true);
    assert.equal(summary.valid, false);
});
