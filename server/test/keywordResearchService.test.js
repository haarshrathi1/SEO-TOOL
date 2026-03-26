const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../keywordResearchService');

test('normalizeKeywordUniverse sanitizes malformed keyword payloads', () => {
    const normalized = __internal.normalizeKeywordUniverse({
        keywords: [
            {
                term: ' CRM software ',
                intent: 'commercial',
                volume: 'HIGH',
                difficulty: 'easy',
                opportunityScore: '89.7',
                source: 'PAA',
                buyerStage: 'decision',
            },
            {
                keyword: 'crm software',
                intent: 'unknown',
                opportunityScore: 10,
            },
            {
                term: '   ',
            },
        ],
        questionKeywords: [
            'what is crm',
            { keyword: 'best crm for agencies', intent: 'Transactional', volume: 'MEDIUM' },
            { question: '' },
        ],
        lsiTerms: ['crm', 'CRM', 'automation'],
        longTailGems: [
            { term: 'crm for small teams', reason: 'niche', opportunityScore: 140 },
            { keyword: 'crm for agencies' },
            {},
        ],
    });

    assert.equal(normalized.totalKeywords, 1);
    assert.equal(normalized.keywords[0].term, 'CRM software');
    assert.equal(normalized.keywords[0].intent, 'Commercial');
    assert.equal(normalized.keywords[0].volume, 'High');
    assert.equal(normalized.keywords[0].difficulty, 'Easy');
    assert.equal(normalized.keywords[0].source, 'paa');
    assert.equal(normalized.keywords[0].buyerStage, 'Decision');
    assert.equal(normalized.keywords[0].opportunityScore, 90);

    assert.equal(normalized.questionKeywords.length, 2);
    assert.equal(normalized.questionKeywords[0].question, 'what is crm');
    assert.equal(normalized.questionKeywords[1].intent, 'Transactional');
    assert.equal(normalized.questionKeywords[1].volume, 'Medium');

    assert.deepEqual(normalized.lsiTerms, ['crm', 'automation']);
    assert.equal(normalized.longTailGems.length, 2);
    assert.equal(normalized.longTailGems[0].opportunityScore, 100);
});

test('normalizeStrategicSynthesis and buildAnalysisMapping return stable shapes', () => {
    const strategy = __internal.normalizeStrategicSynthesis({
        difficulty: { score: '101', label: 'Impossible', reason: '' },
        viability: {
            soloCreator: { verdict: 'high', reason: '' },
            smallBusiness: { verdict: 'invalid', reason: 'Budget constraints' },
        },
        clusters: [
            {
                name: 'Core cluster',
                priority: 'P9',
                intent: 'Commercial',
                contentFormat: 'Landing page',
                estimatedTraffic: 'HIGH',
                keywords: [
                    { term: 'crm software', intent: 'commercial', volume: 'high', opportunityScore: 77 },
                ],
            },
        ],
        quickWins: [
            { keyword: 'crm templates', reason: 'Gap', action: 'Ship landing page', timeToRank: '4-6 weeks' },
        ],
        contentBlueprint: {
            primaryFormat: 'Guide',
            wordCountTarget: '1500 words',
            uniqueAngle: 'Real implementation playbook',
            mustInclude: ['pricing', 'cases'],
            avoid: ['fluff'],
            timeToImpact: '8 weeks',
            confidence: 'LOW',
        },
        alternativeStrategy: {
            angle: 'Niche down',
            reason: 'Compete where authority is weaker',
            keywords: ['crm for agencies', 'CRM for agencies'],
        },
        contentGap: 'Current SERP misses implementation depth',
        executionPriority: ['Publish cluster page', 'Build comparison table'],
    });

    assert.equal(strategy.difficulty.score, 100);
    assert.equal(strategy.difficulty.label, 'Moderate');
    assert.equal(strategy.viability.soloCreator.verdict, 'High');
    assert.equal(strategy.viability.smallBusiness.verdict, 'Medium');
    assert.equal(strategy.viability.brand.verdict, 'Medium');
    assert.equal(strategy.clusters[0].priority, 'P2');
    assert.equal(strategy.clusters[0].keywords[0].volume, 'High');
    assert.equal(strategy.contentBlueprint.confidence, 'Low');
    assert.deepEqual(strategy.alternativeStrategy.keywords, ['crm for agencies']);

    const analysis = __internal.buildAnalysisMapping(strategy);
    assert.equal(analysis.clusters[0].keywords[0].vol, 'High');
    assert.equal(analysis.viability.soloCreator, 'High');
    assert.equal(analysis.recommendedStrategy.confidence, 'Low');
});
