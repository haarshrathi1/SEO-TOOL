const test = require('node:test');
const assert = require('node:assert/strict');

const keywordAdsAccess = require('../keywordAdsAccess');
const dataforseoAds = require('../dataforseoAds');
const usageWindows = require('../usageWindows');

test('getKeywordAdsWeekKey is stable for dates within the same UTC week', () => {
    const monday = keywordAdsAccess.getKeywordAdsWeekKey(new Date('2026-03-23T12:00:00Z'));
    const thursday = keywordAdsAccess.getKeywordAdsWeekKey(new Date('2026-03-26T08:30:00Z'));
    const nextWeek = keywordAdsAccess.getKeywordAdsWeekKey(new Date('2026-03-30T00:05:00Z'));

    assert.equal(monday, '2026-03-23');
    assert.equal(thursday, '2026-03-23');
    assert.equal(nextWeek, '2026-03-30');
});

test('getKeywordAdsDayKey keeps the UTC day boundary stable', () => {
    assert.equal(
        keywordAdsAccess.getKeywordAdsDayKey(new Date('2026-03-23T23:59:59Z')),
        '2026-03-23',
    );
    assert.equal(
        keywordAdsAccess.getKeywordAdsDayKey(new Date('2026-03-24T00:00:01Z')),
        '2026-03-24',
    );
});

test('buildAdsSeedKeywords deduplicates, normalizes, and skips question-style inputs', () => {
    const seeds = dataforseoAds.buildAdsSeedKeywords({
        seed: 'Preventive Fleet Maintenance',
        suggestions: ['fleet maintenance checklist', 'How to build a fleet maintenance schedule', 'fleet maintenance checklist'],
        serpData: {
            relatedSearches: ['fleet maintenance pdf', 'fleet maintenance pdf'],
        },
        keywordUniverse: {
            keywords: [
                { term: 'fleet maintenance checklist', opportunityScore: 80 },
                { term: 'fleet preventive maintenance schedule template excel', opportunityScore: 90 },
            ],
            longTailGems: [
                { term: 'fleet maintenance plan pdf' },
            ],
        },
    });

    assert.deepEqual(seeds, [
        'preventive fleet maintenance',
        'fleet preventive maintenance schedule template excel',
        'fleet maintenance checklist',
        'fleet maintenance pdf',
        'fleet maintenance plan pdf',
    ]);
});

test('duplicate-key detection only flags Mongo duplicate-key failures', () => {
    assert.equal(usageWindows.__internal.isDuplicateKeyError({ code: 11000 }), true);
    assert.equal(usageWindows.__internal.isDuplicateKeyError({ code: 500 }), false);
    assert.equal(usageWindows.__internal.isDuplicateKeyError(null), false);
});
