const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../keywords');

test('normalizeScanUrl accepts http(s) URLs and auto-adds https', () => {
    assert.equal(__internal.normalizeScanUrl('https://example.com/path'), 'https://example.com/path');
    assert.equal(__internal.normalizeScanUrl('example.com'), 'https://example.com/');
    assert.equal(__internal.normalizeScanUrl('ftp://example.com'), '');
    assert.equal(__internal.normalizeScanUrl('   '), '');
});

test('isPrivateHostname blocks localhost and private networks', () => {
    assert.equal(__internal.isPrivateHostname('localhost'), true);
    assert.equal(__internal.isPrivateHostname('127.0.0.1'), true);
    assert.equal(__internal.isPrivateHostname('10.1.2.3'), true);
    assert.equal(__internal.isPrivateHostname('172.16.5.4'), true);
    assert.equal(__internal.isPrivateHostname('192.168.1.40'), true);
    assert.equal(__internal.isPrivateHostname('example.com'), false);
    assert.equal(__internal.isPrivateHostname('8.8.8.8'), false);
});

test('shouldUseRenderedFallback switches on for thin SPA shells', () => {
    assert.equal(__internal.shouldUseRenderedFallback({
        wordCount: 80,
        hasSpaShellMarkers: false,
    }), true);

    assert.equal(__internal.shouldUseRenderedFallback({
        wordCount: 250,
        hasSpaShellMarkers: true,
    }), true);

    assert.equal(__internal.shouldUseRenderedFallback({
        wordCount: 640,
        hasSpaShellMarkers: true,
    }), false);
});

test('buildKeywordScanResult returns scan source and top keyword counts', () => {
    const result = __internal.buildKeywordScanResult(
        'https://example.com/',
        'CRM software crm software automation platform platform crm software',
        'rendered'
    );

    assert.equal(result.scanSource, 'rendered');
    assert.equal(result.totalWords, 9);
    const crmSoftware = result.topKeywords.find((keyword) => keyword.keyword === 'crm software');
    assert.equal(crmSoftware?.count, 3);
});
