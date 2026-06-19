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

test('applyGroundedSearchUsageLimit increments usage within the same day', () => {
    const decision = __internal.applyGroundedSearchUsageLimit(
        { date: '2026-03-25', count: 2 },
        { dateKey: '2026-03-25', limit: 5 }
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.reason, 'ok');
    assert.equal(decision.used, 3);
    assert.equal(decision.remaining, 2);
    assert.deepEqual(decision.nextState, { date: '2026-03-25', count: 3 });
});

test('applyGroundedSearchUsageLimit blocks once the daily cap is reached', () => {
    const decision = __internal.applyGroundedSearchUsageLimit(
        { date: '2026-03-25', count: 5 },
        { dateKey: '2026-03-25', limit: 5 }
    );

    assert.equal(decision.allowed, false);
    assert.equal(decision.reason, 'daily_limit_reached');
    assert.equal(decision.used, 5);
    assert.equal(decision.remaining, 0);
});

test('applyGroundedSearchUsageLimit resets usage across date boundaries', () => {
    const decision = __internal.applyGroundedSearchUsageLimit(
        { date: '2026-03-24', count: 500 },
        { dateKey: '2026-03-25', limit: 500 }
    );

    assert.equal(decision.allowed, true);
    assert.equal(decision.used, 1);
    assert.equal(decision.remaining, 499);
    assert.deepEqual(decision.nextState, { date: '2026-03-25', count: 1 });
});

test('normalizeBlogBrief keeps a valid model brief and normalizes roles and sources', () => {
    const brief = __internal.normalizeBlogBrief({
        recommendedTitle: 'CRM Software: The Honest Guide',
        titleOptions: ['CRM Software: The Honest Guide', 'Best CRM Software Compared'],
        metaDescription: 'Compare CRM software with real pricing and real questions answered.',
        slug: 'CRM Software Guide!!',
        readerPromise: 'Pick the right CRM in one read.',
        targetKeywords: [
            { term: 'crm software', role: 'PRIMARY', placement: 'H1 + first 100 words' },
            { term: 'best crm for agencies', role: 'nonsense-role', placement: 'H2' },
        ],
        outline: [
            { heading: 'What is CRM software?', purpose: 'Define it', coversQueries: ['what is crm'] },
            { heading: 'Pricing compared', purpose: 'Costs', coversQueries: [] },
            { heading: 'Best picks by team size', purpose: 'Recommendations', coversQueries: ['best crm for agencies'] },
        ],
        faq: [
            { question: 'What is CRM used for?', source: 'paa', answerAngle: 'Short answer first.' },
            { question: 'Is there free CRM?', source: 'made-up-source', answerAngle: '' },
        ],
        searcherLanguage: ['crm software for small business', 'crm software pricing'],
    }, { seed: 'crm software' });

    assert.equal(brief.generatedBy, 'model');
    assert.equal(brief.slug, 'crm-software-guide');
    assert.equal(brief.targetKeywords[0].role, 'primary');
    assert.equal(brief.targetKeywords[1].role, 'supporting');
    assert.equal(brief.faq[1].source, 'paa');
    assert.equal(brief.outline.length, 3);
});

test('normalizeBlogBrief falls back to a brief built from real search data', () => {
    const brief = __internal.normalizeBlogBrief(null, {
        seed: 'crm software',
        paaQuestions: ['What does CRM stand for?', 'Is CRM worth it for small business?'],
        relatedSearches: ['crm software free', 'crm software examples'],
        suggestions: ['crm software for small business'],
        keywordUniverse: { keywords: [{ term: 'best crm software' }, { term: 'crm software' }] },
    });

    assert.equal(brief.generatedBy, 'fallback');
    assert.equal(brief.slug, 'crm-software');
    assert.equal(brief.targetKeywords[0].term, 'crm software');
    assert.equal(brief.targetKeywords[0].role, 'primary');
    assert.ok(brief.faq.every((entry) => entry.source === 'paa'));
    assert.ok(brief.faq.some((entry) => entry.question === 'What does CRM stand for?'));
    assert.ok(brief.outline.length >= 3);
    assert.ok(brief.searcherLanguage.includes('crm software free'));
});

test('normalizeBlogBrief rejects a thin model brief in favor of the fallback', () => {
    const brief = __internal.normalizeBlogBrief({
        recommendedTitle: 'Title only, no outline or keywords',
        outline: [{ heading: 'Single section' }],
    }, {
        seed: 'crm software',
        paaQuestions: ['What does CRM stand for?'],
        relatedSearches: [],
        suggestions: [],
        keywordUniverse: { keywords: [] },
    });

    assert.equal(brief.generatedBy, 'fallback');
});
