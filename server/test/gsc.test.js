const test = require('node:test');
const assert = require('node:assert/strict');

const gsc = require('../gsc');

test('computeSiteTotals uses impression-weighted average position', () => {
    const totals = gsc.__internal.computeSiteTotals([
        { clicks: 10, impressions: 100, position: 1 },
        { clicks: 1, impressions: 1, position: 100 },
    ]);

    assert.equal(totals.clicks, 11);
    assert.equal(totals.impressions, 101);
    assert.equal(totals.ctr, '10.89');
    assert.equal(totals.avgPosition, '1.98');
});
