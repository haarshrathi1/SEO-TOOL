const test = require('node:test');
const assert = require('node:assert/strict');

const { getWeeklyDateRange } = require('../utils');

test('getWeeklyDateRange returns a Sunday-Saturday window with an ASCII week label', () => {
    const result = getWeeklyDateRange();

    assert.match(result.weekLabel, /^Week \d{4}-\d{2}-\d{2} -> \d{4}-\d{2}-\d{2}$/);

    const start = new Date(`${result.startDate}T00:00:00Z`);
    const end = new Date(`${result.endDate}T00:00:00Z`);

    assert.equal(start.getUTCDay(), 0);
    assert.equal(end.getUTCDay(), 6);
    assert.equal((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000), 6);
});
