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
