const fs = require('node:fs/promises');
const path = require('node:path');
const axios = require('axios');

const {
    BACKEND_VERTEX,
    formatBackendLabel,
    generateJson,
    getProviderRuntime,
} = require('./genaiProvider');
const {
    getCachedKeywordAdsSnapshot,
    saveKeywordAdsSnapshot,
} = require('./dataforseoAds');
const {
    fetchLiveKeywordAdsSnapshot,
    getPreferredKeywordAdsProviderConfig,
} = require('./keywordAdsProviders');
const {
    getKeywordAdsUsageStatus,
    releaseKeywordAdsUsage,
    reserveKeywordAdsUsage,
} = require('./keywordAdsAccess');

const TOTAL_LAYERS = 5;
const LAYER_LABELS = {
    1: 'Collecting data',
    2: 'SERP DNA analysis',
    3: 'Intent decomposition',
    4: 'Keyword expansion',
    5: 'Strategic synthesis',
};
const DEFAULT_GROUNDED_SEARCH_DAILY_LIMIT = 500;
const GROUNDED_SEARCH_USAGE_FILE = process.env.GROUNDED_SEARCH_USAGE_FILE || path.join(__dirname, 'data', 'grounding_usage.json');
let groundingUsageWriteQueue = Promise.resolve();

function parseGroundedSearchDailyLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_GROUNDED_SEARCH_DAILY_LIMIT;
    }
    return Math.floor(parsed);
}

const GROUNDED_SEARCH_DAILY_LIMIT = parseGroundedSearchDailyLimit(
    process.env.GROUNDED_SEARCH_DAILY_LIMIT
    || process.env.GOOGLE_SEARCH_GROUNDING_DAILY_LIMIT
);

function getRuntimeProviderLabel() {
    const runtime = getProviderRuntime();
    const fallbackLabel = runtime.allowGeminiFallback && runtime.availableBackends.includes('gemini')
        ? ' with Gemini backup'
        : '';
    const primaryLabel = formatBackendLabel(runtime.primaryBackend);
    return `${primaryLabel} primary${fallbackLabel}`;
}

function clampPercent(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function getLayerPercent(layer, phase = 'start') {
    const completedShare = ((Math.max(1, layer) - 1) / TOTAL_LAYERS) * 100;
    if (phase === 'complete') {
        return clampPercent((layer / TOTAL_LAYERS) * 100);
    }
    if (phase === 'mid') {
        return clampPercent(completedShare + (100 / TOTAL_LAYERS) * 0.55);
    }
    return clampPercent(completedShare + (100 / TOTAL_LAYERS) * 0.15);
}

async function pushProgress(onProgress, update) {
    if (typeof onProgress !== 'function') {
        return;
    }

    await onProgress(update);
}

function buildProgressUpdate(layer, message, options = {}) {
    const safeLayer = Math.max(0, Math.min(TOTAL_LAYERS, Number(layer) || 0));
    const completed = options.phase === 'complete'
        ? safeLayer
        : Math.max(0, safeLayer - (safeLayer > 0 ? 1 : 0));

    return {
        stage: options.stage || (safeLayer > 0 ? `Layer ${safeLayer}` : 'Queued'),
        label: options.label || (safeLayer > 0 ? LAYER_LABELS[safeLayer] : 'Queued'),
        currentLayer: safeLayer,
        totalLayers: TOTAL_LAYERS,
        completed,
        total: TOTAL_LAYERS,
        percent: options.percent ?? getLayerPercent(safeLayer || 1, options.phase || 'start'),
        message,
        provider: options.provider || getRuntimeProviderLabel(),
    };
}

function createProviderEventHandler({ onProgress, layer, label }) {
    return (event) => {
        if (typeof onProgress !== 'function') {
            return;
        }

        if (event.type === 'retry') {
            void pushProgress(onProgress, buildProgressUpdate(layer, `${event.provider} is busy. Retrying ${label.toLowerCase()} (${event.attempt}/${event.maxAttempts})...`, {
                phase: 'mid',
            }));
            return;
        }

        if (event.type === 'fallback') {
            const fromLabel = formatBackendLabel(event.from);
            const toLabel = formatBackendLabel(event.to);
            void pushProgress(onProgress, buildProgressUpdate(layer, `${fromLabel} hit a limit. Switching ${label.toLowerCase()} to ${toLabel}.`, {
                phase: 'mid',
                provider: `${toLabel} active`,
            }));
            return;
        }

        if (event.type === 'model_fallback') {
            void pushProgress(onProgress, buildProgressUpdate(layer, `${event.fromModel} was unavailable. Retrying ${label.toLowerCase()} with ${event.toModel}.`, {
                phase: 'mid',
            }));
        }
    };
}

function buildMetadata(meta) {
    return {
        model: meta?.model || getProviderRuntime().keywordModel,
        layers: TOTAL_LAYERS,
        timestamp: new Date().toISOString(),
        provider: meta?.provider || getRuntimeProviderLabel(),
        backend: meta?.backend || getProviderRuntime().primaryBackend,
    };
}

const SERP_PERSONALITIES = ['Knowledge Hub', 'Commercial Battlefield', 'Tutorial Playground', 'News Feed', 'Community Forum', 'Mixed Bazaar'];
const DIFFICULTY_VERDICTS = ['Easy Pickings', 'Moderate Fight', 'Tough Battle', 'Near Impossible'];
const KEYWORD_INTENTS = ['Informational', 'Commercial', 'Transactional', 'Navigational', 'Comparison'];
const KEYWORD_VOLUMES = ['High', 'Medium', 'Low'];
const KEYWORD_DIFFICULTIES = ['Easy', 'Medium', 'Hard'];
const BUYER_STAGES = ['Awareness', 'Consideration', 'Decision', 'Retention'];
const STRATEGY_DIFFICULTY_LABELS = ['Easy', 'Moderate', 'Hard', 'Very Hard', 'Near Impossible'];
const VIABILITY_VERDICTS = ['High', 'Medium', 'Low'];
const STRATEGY_PRIORITIES = ['P0', 'P1', 'P2', 'P3'];
const KEYWORD_SOURCES = ['autocomplete', 'paa', 'related', 'serp_implied', 'long_tail', 'ads'];
const CONFIDENCE_LABELS = ['High', 'Medium', 'Low'];

function asString(value, fallback = '') {
    if (typeof value !== 'string') {
        return fallback;
    }
    const trimmed = value.trim();
    return trimmed || fallback;
}

function asNumber(value, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function clampNumber(value, min, max, fallback) {
    return Math.max(min, Math.min(max, asNumber(value, fallback)));
}

function normalizeChoice(value, choices, fallback) {
    const normalized = asString(value);
    if (!normalized) {
        return fallback;
    }

    const matched = choices.find((choice) => choice.toLowerCase() === normalized.toLowerCase());
    return matched || fallback;
}

function normalizeUniqueStrings(values, limit = 20) {
    if (!Array.isArray(values)) {
        return [];
    }

    const seen = new Set();
    const normalized = [];
    for (const entry of values) {
        const value = asString(entry);
        if (!value) {
            continue;
        }
        const key = value.toLowerCase();
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        normalized.push(value);
        if (normalized.length >= limit) {
            break;
        }
    }
    return normalized;
}

function normalizeKeywordKey(value) {
    return asString(value).toLowerCase().replace(/\s+/g, ' ').trim();
}

function phraseMatchesKeyword(termKey, candidate) {
    const candidateKey = normalizeKeywordKey(candidate);
    if (!termKey || !candidateKey) {
        return false;
    }

    return candidateKey === termKey
        || candidateKey.includes(termKey)
        || (termKey.split(' ').length >= 2 && termKey.includes(candidateKey));
}

function volumeLabelFromSearchVolume(searchVolume, fallback = 'Low') {
    if (!Number.isFinite(searchVolume)) {
        return fallback;
    }
    if (searchVolume >= 1000) {
        return 'High';
    }
    if (searchVolume >= 100) {
        return 'Medium';
    }
    return 'Low';
}

function difficultyLabelFromScore(score) {
    if (score >= 24) {
        return 'Hard';
    }
    if (score >= 12) {
        return 'Medium';
    }
    return 'Easy';
}

function normalizeAdsMetrics(rawMetrics) {
    if (!rawMetrics || typeof rawMetrics !== 'object') {
        return null;
    }

    const searchVolume = asNumber(rawMetrics.searchVolume, NaN);
    const competitionIndex = asNumber(rawMetrics.competitionIndex, NaN);
    const cpc = asNumber(rawMetrics.cpc, NaN);
    const lowTopOfPageBid = asNumber(rawMetrics.lowTopOfPageBid, NaN);
    const highTopOfPageBid = asNumber(rawMetrics.highTopOfPageBid, NaN);

    return {
        searchVolume: Number.isFinite(searchVolume) ? Math.round(searchVolume) : null,
        competition: asString(rawMetrics.competition, '').toUpperCase() || null,
        competitionIndex: Number.isFinite(competitionIndex) ? Math.round(competitionIndex) : null,
        cpc: Number.isFinite(cpc) ? Number(cpc.toFixed(2)) : null,
        lowTopOfPageBid: Number.isFinite(lowTopOfPageBid) ? Number(lowTopOfPageBid.toFixed(2)) : null,
        highTopOfPageBid: Number.isFinite(highTopOfPageBid) ? Number(highTopOfPageBid.toFixed(2)) : null,
        monthlySearches: Array.isArray(rawMetrics.monthlySearches)
            ? rawMetrics.monthlySearches
                .map((month) => ({
                    year: asNumber(month?.year, NaN),
                    month: asNumber(month?.month, NaN),
                    searchVolume: asNumber(month?.searchVolume, NaN),
                }))
                .filter((month) => Number.isFinite(month.year) && Number.isFinite(month.month))
                .slice(0, 12)
            : [],
    };
}

function buildAdsMetricsMap(adsSnapshot) {
    const entries = Array.isArray(adsSnapshot?.results) ? adsSnapshot.results : [];
    const map = new Map();
    for (const entry of entries) {
        const keyword = normalizeKeywordKey(entry?.keyword);
        const metrics = normalizeAdsMetrics(entry);
        if (!keyword || !metrics) {
            continue;
        }
        map.set(keyword, metrics);
    }
    return map;
}

function countEvidenceMatches(termKey, values) {
    if (!termKey || !Array.isArray(values) || values.length === 0) {
        return 0;
    }

    return values.reduce((count, value) => (phraseMatchesKeyword(termKey, value) ? count + 1 : count), 0);
}

function computeBusinessValueScore(termKey) {
    let score = 6;

    if (/\b(software|platform|tool|tools|comparison|compare|vs|pricing|cost|roi|demo)\b/.test(termKey)) {
        score += 10;
    }

    if (/\b(template|checklist|pdf|excel|form|calculator)\b/.test(termKey)) {
        score += 8;
    }

    if (/\b(best|guide|how to|tutorial|program|plan)\b/.test(termKey)) {
        score += 4;
    }

    return Math.min(20, score);
}

function computeGapScore(termKey, serpDna) {
    const contentGaps = Array.isArray(serpDna?.contentGaps) ? serpDna.contentGaps.map((gap) => normalizeKeywordKey(gap)) : [];
    let score = 0;

    if (/\b(template|checklist|pdf|excel|form)\b/.test(termKey) && contentGaps.some((gap) => /\b(template|checklist|pdf|download|resource)\b/.test(gap))) {
        score += 10;
    }

    if (/\b(video|tutorial)\b/.test(termKey) && contentGaps.some((gap) => /\b(video|tutorial)\b/.test(gap))) {
        score += 8;
    }

    if (/\b(cost|roi)\b/.test(termKey) && contentGaps.some((gap) => /\b(cost|roi)\b/.test(gap))) {
        score += 8;
    }

    return Math.min(15, score);
}

function computeIntentAlignmentScore(keyword, intentData) {
    const primaryIntent = normalizeKeywordKey(intentData?.primaryIntent);
    const intent = asString(keyword.intent, 'Informational');

    let score = 8;
    if (intent === 'Transactional') {
        score += 7;
    } else if (intent === 'Commercial' || intent === 'Comparison') {
        score += 6;
    } else if (intent === 'Informational') {
        score += 4;
    }

    if (primaryIntent.includes(intent.toLowerCase())) {
        score += 5;
    }

    const buyerStage = asString(keyword.buyerStage, fallbackBuyerStage(intent));
    if (buyerStage === 'Decision') {
        score += 3;
    } else if (buyerStage === 'Consideration') {
        score += 2;
    }

    return Math.min(18, score);
}

function inferIntentFromTerm(term) {
    const termKey = normalizeKeywordKey(term);
    if (/\b(vs|versus|compare|comparison)\b/.test(termKey)) {
        return 'Comparison';
    }
    if (/\b(price|pricing|buy|cost|quote|software|tool|tools|template|checklist|pdf|excel|form|roi)\b/.test(termKey)) {
        return 'Commercial';
    }
    return 'Informational';
}

function computeDemandScore(keyword, context) {
    const termKey = normalizeKeywordKey(keyword.term);
    const adsMetrics = normalizeAdsMetrics(keyword.adsMetrics);

    if (Number.isFinite(adsMetrics?.searchVolume)) {
        const searchVolume = adsMetrics.searchVolume;
        if (searchVolume >= 10000) return 35;
        if (searchVolume >= 1000) return 30;
        if (searchVolume >= 100) return 24;
        if (searchVolume >= 10) return 16;
        return 8;
    }

    const evidenceValues = [
        ...((context.suggestions || []).slice(0, 20)),
        ...((context.serpData?.relatedSearches || []).slice(0, 12)),
        ...((context.serpData?.paaQuestions || []).slice(0, 12).map((question) => question.question)),
        ...((context.serpData?.organic || []).slice(0, 10).flatMap((result) => [result.title, result.snippet])),
        ...((context.groundedSearch?.relatedQueries || []).slice(0, 12)),
        ...((context.groundedSearch?.questions || []).slice(0, 12)),
    ];

    const exactEvidenceMatches = countEvidenceMatches(termKey, evidenceValues);
    const sourceBonus = keyword.source === 'autocomplete'
        ? 4
        : keyword.source === 'related'
            ? 3
            : keyword.source === 'long_tail'
                ? 2
                : 1;
    const specificityBonus = Math.min(6, Math.max(0, termKey.split(' ').length - 1) * 2);

    return Math.min(28, 6 + (exactEvidenceMatches * 4) + sourceBonus + specificityBonus);
}

function computeDifficultyScore(keyword, context) {
    const termKey = normalizeKeywordKey(keyword.term);
    const adsMetrics = normalizeAdsMetrics(keyword.adsMetrics);
    const brandPressure = clampNumber(context.serpSummary?.brandPressureIndex, 0, 100, 40);
    let score = Math.round((brandPressure / 100) * 18);

    if (context.serpDna?.difficultyVerdict === 'Tough Battle') {
        score += 6;
    } else if (context.serpDna?.difficultyVerdict === 'Near Impossible') {
        score += 10;
    } else if (context.serpDna?.difficultyVerdict === 'Moderate Fight') {
        score += 3;
    }

    if (/\b(software|comparison|compare|vs|cost|roi)\b/.test(termKey)) {
        score += 6;
    }

    if (/\b(template|checklist|pdf|excel|form|video|tutorial)\b/.test(termKey)) {
        score -= 3;
    }

    if (Number.isFinite(adsMetrics?.competitionIndex)) {
        score += Math.round((adsMetrics.competitionIndex / 100) * 10);
    }

    return Math.max(4, Math.min(35, score));
}

function scoreKeyword(keyword, context) {
    const termKey = normalizeKeywordKey(keyword.term);
    const adsMetrics = normalizeAdsMetrics(keyword.adsMetrics);
    const demandScore = computeDemandScore(keyword, context);
    const intentScore = computeIntentAlignmentScore(keyword, context.intentData);
    const businessValueScore = computeBusinessValueScore(termKey);
    const gapScore = computeGapScore(termKey, context.serpDna);
    const difficultyScore = computeDifficultyScore(keyword, context);
    const stageBonus = keyword.buyerStage === 'Decision' ? 4 : keyword.buyerStage === 'Consideration' ? 2 : 0;
    const opportunityScore = clampNumber(demandScore + intentScore + businessValueScore + gapScore + stageBonus - difficultyScore, 0, 100, 0);

    return {
        ...keyword,
        adsMetrics,
        volume: volumeLabelFromSearchVolume(
            Number.isFinite(adsMetrics?.searchVolume) ? adsMetrics.searchVolume : NaN,
            demandScore >= 20 ? 'Medium' : 'Low'
        ),
        difficulty: difficultyLabelFromScore(difficultyScore),
        opportunityScore: Math.round(opportunityScore),
    };
}

function rescoreKeywordUniverse(keywordUniverse, context) {
    const source = keywordUniverse && typeof keywordUniverse === 'object' ? keywordUniverse : {};
    const keywords = Array.isArray(source.keywords)
        ? source.keywords
            .map((keyword) => normalizeKeywordItem(keyword))
            .filter(Boolean)
            .map((keyword) => scoreKeyword(keyword, context))
            .sort((left, right) => right.opportunityScore - left.opportunityScore || left.term.localeCompare(right.term))
            .slice(0, 60)
        : [];

    return {
        ...source,
        totalKeywords: keywords.length,
        keywords,
    };
}

function mergeKeywordAdsData(keywordUniverse, adsSnapshot, context) {
    const adsMetricsMap = buildAdsMetricsMap(adsSnapshot);
    const mergedKeywords = Array.isArray(keywordUniverse?.keywords)
        ? keywordUniverse.keywords.map((keyword) => {
            const normalized = normalizeKeywordItem(keyword);
            if (!normalized) {
                return null;
            }

            return {
                ...normalized,
                adsMetrics: adsMetricsMap.get(normalizeKeywordKey(normalized.term)) || normalized.adsMetrics || null,
            };
        }).filter(Boolean)
        : [];

    const seenKeywords = new Set(mergedKeywords.map((keyword) => normalizeKeywordKey(keyword.term)));
    const adsAdditions = Array.isArray(adsSnapshot?.results)
        ? adsSnapshot.results
            .map((entry) => {
                const term = normalizeKeywordKey(entry?.keyword);
                if (!term || seenKeywords.has(term)) {
                    return null;
                }
                seenKeywords.add(term);

                const intent = inferIntentFromTerm(term);
                return {
                    term,
                    intent,
                    volume: volumeLabelFromSearchVolume(asNumber(entry?.searchVolume, NaN), 'Low'),
                    difficulty: 'Medium',
                    opportunityScore: 0,
                    source: 'ads',
                    buyerStage: fallbackBuyerStage(intent),
                    adsMetrics: normalizeAdsMetrics(entry),
                };
            })
            .filter(Boolean)
            .slice(0, 12)
        : [];

    return rescoreKeywordUniverse({
        ...keywordUniverse,
        keywords: [...mergedKeywords, ...adsAdditions],
    }, context);
}

function fallbackBuyerStage(intent) {
    switch (intent) {
    case 'Transactional':
        return 'Decision';
    case 'Commercial':
    case 'Comparison':
        return 'Consideration';
    case 'Navigational':
        return 'Decision';
    default:
        return 'Awareness';
    }
}

function normalizeKeywordItem(rawItem) {
    if (!rawItem || typeof rawItem !== 'object') {
        return null;
    }

    const term = asString(rawItem.term || rawItem.keyword || rawItem.query);
    if (!term) {
        return null;
    }

    const intent = normalizeChoice(rawItem.intent, KEYWORD_INTENTS, 'Informational');
    const volume = normalizeChoice(rawItem.volume, KEYWORD_VOLUMES, 'Low');
    const difficulty = normalizeChoice(rawItem.difficulty, KEYWORD_DIFFICULTIES, 'Medium');
    const source = normalizeChoice(rawItem.source, KEYWORD_SOURCES, 'serp_implied');
    const buyerStage = normalizeChoice(rawItem.buyerStage, BUYER_STAGES, fallbackBuyerStage(intent));
    const opportunityScore = Math.round(clampNumber(rawItem.opportunityScore, 0, 100, 0));

    return {
        term,
        intent,
        volume,
        difficulty,
        opportunityScore,
        source,
        buyerStage,
        adsMetrics: normalizeAdsMetrics(rawItem.adsMetrics),
    };
}

function normalizeQuestionKeyword(rawItem) {
    const raw = typeof rawItem === 'string'
        ? { question: rawItem }
        : (rawItem && typeof rawItem === 'object' ? rawItem : null);

    if (!raw) {
        return null;
    }

    const question = asString(raw.question || raw.term || raw.keyword || raw.query);
    if (!question) {
        return null;
    }

    return {
        question,
        intent: normalizeChoice(raw.intent, KEYWORD_INTENTS, 'Informational'),
        volume: normalizeChoice(raw.volume, KEYWORD_VOLUMES, 'Low'),
    };
}

function normalizeLongTailGem(rawItem) {
    if (!rawItem || typeof rawItem !== 'object') {
        return null;
    }

    const term = asString(rawItem.term || rawItem.keyword || rawItem.query);
    if (!term) {
        return null;
    }

    return {
        term,
        reason: asString(rawItem.reason, 'Opportunity identified from SERP language patterns.'),
        opportunityScore: Math.round(clampNumber(rawItem.opportunityScore, 0, 100, 0)),
    };
}

function normalizeSerpDna(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        serpPersonality: normalizeChoice(source.serpPersonality, SERP_PERSONALITIES, 'Mixed Bazaar'),
        googleWants: asString(source.googleWants, 'Google favors pages that match dominant intent and satisfy core query expectations.'),
        contentFormatDominance: normalizeUniqueStrings(source.contentFormatDominance, 4),
        eatSignals: {
            experience: asString(source.eatSignals?.experience, 'Practical examples and implementation detail.'),
            expertise: asString(source.eatSignals?.expertise, 'Demonstrated topical depth.'),
            authority: asString(source.eatSignals?.authority, 'Trusted domain or author signals.'),
            trust: asString(source.eatSignals?.trust, 'Transparent claims and credible sourcing.'),
        },
        topicalAuthority: asString(source.topicalAuthority, 'Topical authority appears mixed across the current page-one set.'),
        contentGaps: normalizeUniqueStrings(source.contentGaps, 4),
        rankerProfile: asString(source.rankerProfile, 'Mixed'),
        difficultyVerdict: normalizeChoice(source.difficultyVerdict, DIFFICULTY_VERDICTS, 'Moderate Fight'),
        opportunityAngle: asString(source.opportunityAngle, 'Publish a focused page matching the strongest intent with clearer differentiation.'),
    };
}

function normalizeDistribution(raw, keys) {
    const input = raw && typeof raw === 'object' ? raw : {};
    return keys.reduce((acc, key) => {
        acc[key] = Math.round(clampNumber(input[key], 0, 100, 0));
        return acc;
    }, {});
}

function normalizeIntentDecomposition(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const microIntents = Array.isArray(source.microIntents)
        ? source.microIntents
            .map((entry) => {
                if (!entry || typeof entry !== 'object') {
                    return null;
                }
                const intent = asString(entry.intent);
                if (!intent) {
                    return null;
                }

                return {
                    intent,
                    strength: normalizeChoice(entry.strength, ['High', 'Medium', 'Low'], 'Medium'),
                    example_query: asString(entry.example_query, ''),
                };
            })
            .filter(Boolean)
            .slice(0, 4)
        : [];

    return {
        primaryIntent: asString(source.primaryIntent, 'Informational'),
        intentSpectrum: normalizeDistribution(source.intentSpectrum, ['know', 'do', 'go', 'buy', 'compare', 'learn']),
        buyerJourney: normalizeDistribution(source.buyerJourney, ['awareness', 'consideration', 'decision', 'retention']),
        microIntents,
        intentInsight: asString(source.intentInsight, 'Intent distribution is mixed; prioritize pages that answer the dominant query mode first.'),
        contentAngle: asString(source.contentAngle, 'Answer intent fast with practical proof.'),
    };
}

function normalizeKeywordUniverse(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const uniqueTerms = new Set();
    const keywords = [];

    if (Array.isArray(source.keywords)) {
        for (const entry of source.keywords) {
            const keyword = normalizeKeywordItem(entry);
            if (!keyword) {
                continue;
            }
            const key = keyword.term.toLowerCase();
            if (uniqueTerms.has(key)) {
                continue;
            }
            uniqueTerms.add(key);
            keywords.push(keyword);
            if (keywords.length >= 60) {
                break;
            }
        }
    }

    const questionKeywords = Array.isArray(source.questionKeywords)
        ? source.questionKeywords
            .map((entry) => normalizeQuestionKeyword(entry))
            .filter(Boolean)
            .slice(0, 12)
        : [];

    const longTailGems = Array.isArray(source.longTailGems)
        ? source.longTailGems
            .map((entry) => normalizeLongTailGem(entry))
            .filter(Boolean)
            .slice(0, 12)
        : [];

    return {
        totalKeywords: keywords.length,
        keywords,
        questionKeywords,
        lsiTerms: normalizeUniqueStrings(source.lsiTerms, 24),
        longTailGems,
    };
}

function normalizeCluster(rawCluster) {
    if (!rawCluster || typeof rawCluster !== 'object') {
        return null;
    }

    const name = asString(rawCluster.name);
    if (!name) {
        return null;
    }

    const keywords = Array.isArray(rawCluster.keywords)
        ? rawCluster.keywords
            .map((entry) => {
                const normalized = normalizeKeywordItem(entry);
                if (!normalized) {
                    return null;
                }

                return {
                    term: normalized.term,
                    intent: normalized.intent,
                    volume: normalized.volume,
                    opportunityScore: normalized.opportunityScore,
                };
            })
            .filter(Boolean)
            .slice(0, 5)
        : [];

    return {
        name,
        priority: normalizeChoice(rawCluster.priority, STRATEGY_PRIORITIES, 'P2'),
        intent: asString(rawCluster.intent, 'Informational'),
        keywords,
        contentFormat: asString(rawCluster.contentFormat, 'Guide'),
        estimatedTraffic: normalizeChoice(rawCluster.estimatedTraffic, KEYWORD_VOLUMES, 'Medium'),
    };
}

function normalizeQuickWin(rawItem) {
    if (!rawItem || typeof rawItem !== 'object') {
        return null;
    }

    const keyword = asString(rawItem.keyword || rawItem.term);
    if (!keyword) {
        return null;
    }

    return {
        keyword,
        reason: asString(rawItem.reason, 'Search demand and SERP gaps indicate a short-term opportunity.'),
        action: asString(rawItem.action, 'Publish and optimize a focused page.'),
        timeToRank: asString(rawItem.timeToRank, '8-12 weeks'),
    };
}

function normalizeStrategicSynthesis(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const viability = source.viability && typeof source.viability === 'object' ? source.viability : {};

    const clusters = Array.isArray(source.clusters)
        ? source.clusters
            .map((cluster) => normalizeCluster(cluster))
            .filter(Boolean)
            .slice(0, 4)
        : [];

    const quickWins = Array.isArray(source.quickWins)
        ? source.quickWins
            .map((entry) => normalizeQuickWin(entry))
            .filter(Boolean)
            .slice(0, 4)
        : [];

    const contentBlueprint = source.contentBlueprint && typeof source.contentBlueprint === 'object'
        ? source.contentBlueprint
        : {};
    const alternativeStrategy = source.alternativeStrategy && typeof source.alternativeStrategy === 'object'
        ? source.alternativeStrategy
        : {};

    return {
        difficulty: {
            score: Math.round(clampNumber(source.difficulty?.score, 0, 100, 0)),
            label: normalizeChoice(source.difficulty?.label, STRATEGY_DIFFICULTY_LABELS, 'Moderate'),
            reason: asString(source.difficulty?.reason, 'Competition and intent overlap suggest a moderate effort level.'),
        },
        viability: {
            soloCreator: {
                verdict: normalizeChoice(viability.soloCreator?.verdict, VIABILITY_VERDICTS, 'Medium'),
                reason: asString(viability.soloCreator?.reason, 'Focused execution can compete in selected subtopics.'),
            },
            smallBusiness: {
                verdict: normalizeChoice(viability.smallBusiness?.verdict, VIABILITY_VERDICTS, 'Medium'),
                reason: asString(viability.smallBusiness?.reason, 'Resource constraints require tighter prioritization.'),
            },
            brand: {
                verdict: normalizeChoice(viability.brand?.verdict, VIABILITY_VERDICTS, 'Medium'),
                reason: asString(viability.brand?.reason, 'Brands can scale faster with stronger authority and distribution.'),
            },
        },
        clusters,
        quickWins,
        contentBlueprint: {
            primaryFormat: asString(contentBlueprint.primaryFormat, 'Guide'),
            wordCountTarget: asString(contentBlueprint.wordCountTarget, '1200-1800 words'),
            uniqueAngle: asString(contentBlueprint.uniqueAngle, 'Lead with the clearest intent match and practical examples.'),
            mustInclude: normalizeUniqueStrings(contentBlueprint.mustInclude, 5),
            avoid: normalizeUniqueStrings(contentBlueprint.avoid, 5),
            timeToImpact: asString(contentBlueprint.timeToImpact, '8-12 weeks'),
            confidence: normalizeChoice(contentBlueprint.confidence, CONFIDENCE_LABELS, 'Medium'),
        },
        alternativeStrategy: {
            angle: asString(alternativeStrategy.angle, 'Niche down by user intent segment.'),
            reason: asString(alternativeStrategy.reason, 'A narrower entry point can reduce competition and improve conversion fit.'),
            keywords: normalizeUniqueStrings(alternativeStrategy.keywords, 4),
        },
        contentGap: asString(source.contentGap, 'Current results under-serve nuanced user scenarios and practical implementation detail.'),
        executionPriority: normalizeUniqueStrings(source.executionPriority, 5),
    };
}

function buildAnalysisMapping(strategy) {
    const clusters = Array.isArray(strategy.clusters)
        ? strategy.clusters.map((cluster) => ({
            name: cluster.name,
            keywords: Array.isArray(cluster.keywords)
                ? cluster.keywords.map((keyword) => ({
                    term: keyword.term,
                    intent: keyword.intent,
                    vol: keyword.volume || 'Low',
                }))
                : [],
        }))
        : [];

    return {
        difficulty: strategy.difficulty,
        viability: {
            soloCreator: strategy.viability.soloCreator.verdict,
            smallBusiness: strategy.viability.smallBusiness.verdict,
            brand: strategy.viability.brand.verdict,
        },
        recommendedStrategy: {
            format: strategy.contentBlueprint.primaryFormat,
            angle: strategy.contentBlueprint.uniqueAngle,
            avoid: strategy.contentBlueprint.avoid?.join(', ') || '',
            timeToImpact: strategy.contentBlueprint.timeToImpact,
            confidence: strategy.contentBlueprint.confidence,
        },
        alternativeStrategy: strategy.alternativeStrategy,
        clusters,
        contentGap: strategy.contentGap,
    };
}

function normalizeSeed(seed) {
    return typeof seed === 'string' ? seed.trim() : '';
}

function shouldUseGroundedSearchFallback(suggestions, serpData) {
    const organicCount = serpData?.organic?.length || 0;
    const questionCount = serpData?.paaQuestions?.length || 0;
    const relatedCount = serpData?.relatedSearches?.length || 0;
    const suggestionCount = suggestions?.length || 0;

    if (organicCount === 0) {
        return true;
    }

    if (organicCount < 5) {
        return true;
    }

    return suggestionCount < 5 && (questionCount + relatedCount) < 4;
}

function hasUsableKeywordSourceData(suggestions, serpData, groundedSearch) {
    const organicCount = serpData?.organic?.length || 0;
    const groundedSignals = (groundedSearch?.topDomains?.length || 0)
        + (groundedSearch?.relatedQueries?.length || 0)
        + (groundedSearch?.questions?.length || 0);

    return organicCount > 0 || groundedSignals > 0;
}

function getGroundingDateKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function applyGroundedSearchUsageLimit(state, options = {}) {
    const dateKey = typeof options.dateKey === 'string' && options.dateKey
        ? options.dateKey
        : getGroundingDateKey();
    const limit = parseGroundedSearchDailyLimit(
        options.limit === undefined ? GROUNDED_SEARCH_DAILY_LIMIT : options.limit
    );

    const savedDate = typeof state?.date === 'string' ? state.date : '';
    const savedCount = Number.isFinite(Number(state?.count))
        ? Math.max(0, Math.floor(Number(state.count)))
        : 0;
    const usedSoFar = savedDate === dateKey ? savedCount : 0;
    const baseResult = {
        date: dateKey,
        limit,
    };

    if (limit <= 0) {
        return {
            ...baseResult,
            allowed: false,
            reason: 'limit_disabled',
            used: usedSoFar,
            remaining: 0,
            nextState: { date: dateKey, count: usedSoFar },
        };
    }

    if (usedSoFar >= limit) {
        return {
            ...baseResult,
            allowed: false,
            reason: 'daily_limit_reached',
            used: usedSoFar,
            remaining: 0,
            nextState: { date: dateKey, count: usedSoFar },
        };
    }

    const nextCount = usedSoFar + 1;
    return {
        ...baseResult,
        allowed: true,
        reason: 'ok',
        used: nextCount,
        remaining: Math.max(0, limit - nextCount),
        nextState: { date: dateKey, count: nextCount },
    };
}

async function readGroundedSearchUsage(filePath = GROUNDED_SEARCH_USAGE_FILE) {
    try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        if (error?.code === 'ENOENT') {
            return {};
        }
        throw error;
    }
}

async function writeGroundedSearchUsage(state, filePath = GROUNDED_SEARCH_USAGE_FILE) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(state, null, 2), 'utf8');
}

function withGroundedSearchUsageLock(task) {
    const run = groundingUsageWriteQueue.then(task, task);
    groundingUsageWriteQueue = run.catch(() => {});
    return run;
}

async function reserveGroundedSearchUsage(options = {}) {
    return withGroundedSearchUsageLock(async () => {
        const filePath = options.filePath || GROUNDED_SEARCH_USAGE_FILE;
        const dateKey = typeof options.dateKey === 'string' && options.dateKey
            ? options.dateKey
            : getGroundingDateKey();
        const limit = options.limit === undefined
            ? GROUNDED_SEARCH_DAILY_LIMIT
            : options.limit;

        try {
            const current = await readGroundedSearchUsage(filePath);
            const decision = applyGroundedSearchUsageLimit(current, { dateKey, limit });
            if (decision.allowed) {
                await writeGroundedSearchUsage(decision.nextState, filePath);
            }
            return decision;
        } catch (error) {
            return {
                date: dateKey,
                limit: parseGroundedSearchDailyLimit(limit),
                allowed: false,
                reason: 'tracking_unavailable',
                used: null,
                remaining: null,
                nextState: null,
                error: error.message || 'Unable to track grounded search quota',
            };
        }
    });
}

async function fetchGroundedSearchSnapshot(seed, options = {}) {
    const runtime = getProviderRuntime();
    const prompt = `
You are a search research verifier using Google Search grounding.

TASK: Verify the live search landscape for "${seed}" and return only grounded, non-speculative output.

RULES:
1. Do not invent search volume, CPC, keyword difficulty, or ranking metrics.
2. Use short, factual phrases only when supported by Google Search grounding.
3. If a field is uncertain, return an empty array or "Unknown".
4. Keep "topDomains" to at most 5 items.
5. Keep "relatedQueries", "questions", and "searchHighlights" to at most 6 items each.

Return this exact JSON schema:
{
  "summary": "string",
  "topDomains": ["string"],
  "relatedQueries": ["string"],
  "questions": ["string"],
  "searchHighlights": ["string"],
  "freshness": "Evergreen | Mixed | Fresh | Unknown"
}`;

    const response = await generateJson({
        modelType: 'keyword',
        model: runtime.groundedSearchModel,
        modelFallbacks: [runtime.keywordModel, ...runtime.keywordModelFallbacks],
        preferredBackend: options.preferredBackend || BACKEND_VERTEX,
        taskName: 'grounded search verification',
        contents: prompt,
        useGoogleSearchGrounding: true,
        config: {
            temperature: 0.2,
            maxOutputTokens: 4096,
            tools: [{ type: 'google_search' }],
        },
        onEvent: createProviderEventHandler({
            onProgress: options.onProgress,
            layer: 1,
            label: 'grounded search verification',
        }),
    });

    return { data: response.data, meta: response };
}

async function fetchAutocomplete(seed) {
    try {
        const suffixes = ['', ' best', ' how to', ' vs', ' for', ' tools', ' examples', ' tips'];
        const allSuggestions = new Set();

        await Promise.all(suffixes.map(async (suffix) => {
            try {
                const url = `http://google.com/complete/search?client=chrome&q=${encodeURIComponent(seed + suffix)}`;
                const response = await axios.get(url, { timeout: 3000 });
                if (response.data && response.data[1]) {
                    response.data[1].forEach((suggestion) => allSuggestions.add(suggestion));
                }
            } catch {
                // Ignore partial autocomplete failures.
            }
        }));

        return [...allSuggestions];
    } catch (error) {
        console.error('Autocomplete fetch failed:', error.message);
        return [];
    }
}

async function fetchSERP(query) {
    console.log(`[SerpApi] Fetching results for: ${query}`);

    try {
        if (!process.env.SERP_API_KEY) {
            throw new Error('SERP_API_KEY is missing in .env');
        }

        const response = await axios.get('https://serpapi.com/search.json', {
            params: {
                api_key: process.env.SERP_API_KEY,
                engine: 'google',
                q: query,
                google_domain: 'google.com',
                gl: 'us',
                hl: 'en',
            },
        });

        if (response.data.error) {
            throw new Error(response.data.error);
        }

        const organicResults = response.data.organic_results || [];
        const organic = organicResults.slice(0, 10).map((item) => ({
            title: item.title,
            url: item.link,
            snippet: item.snippet || 'No snippet available',
            position: item.position,
            displayed_link: item.displayed_link,
            sitelinks: Boolean(item.sitelinks),
        }));

        const paaQuestions = (response.data.related_questions || []).map((question) => ({
            question: question.question,
            snippet: question.snippet || '',
            title: question.title || '',
            link: question.link || '',
        }));

        const relatedSearches = (response.data.related_searches || []).map((item) => item.query);
        const knowledgeGraph = response.data.knowledge_graph ? {
            title: response.data.knowledge_graph.title,
            type: response.data.knowledge_graph.type,
            description: response.data.knowledge_graph.description,
        } : null;

        const serpFeatures = [];
        if (response.data.answer_box) serpFeatures.push('featured_snippet');
        if (response.data.knowledge_graph) serpFeatures.push('knowledge_graph');
        if (response.data.related_questions) serpFeatures.push('people_also_ask');
        if (response.data.local_results) serpFeatures.push('local_pack');
        if (response.data.shopping_results) serpFeatures.push('shopping');
        if (response.data.inline_videos) serpFeatures.push('video_carousel');
        if (response.data.inline_images) serpFeatures.push('image_pack');
        if (response.data.top_stories) serpFeatures.push('top_stories');

        console.log(`[SerpApi] Successfully fetched ${organic.length} results, ${paaQuestions.length} PAA, ${relatedSearches.length} related.`);

        return {
            organic,
            paaQuestions,
            relatedSearches,
            knowledgeGraph,
            serpFeatures,
            totalResults: response.data.search_information?.total_results || 0,
        };
    } catch (error) {
        console.error('[SerpApi] Error:', error.message);
        return {
            organic: [],
            paaQuestions: [],
            relatedSearches: [],
            knowledgeGraph: null,
            serpFeatures: [],
            totalResults: 0,
        };
    }
}

async function getQuickWordCount(url) {
    try {
        const response = await axios.get(url, {
            timeout: 3000,
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        });
        const text = response.data.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
        return text.split(' ').length;
    } catch {
        return null;
    }
}

async function analyzeSERP(organic, suggestions = []) {
    if (!organic || organic.length === 0) {
        return null;
    }

    let totalDateCount = 0;
    const types = { informational: 0, transactional: 0, listicle: 0, navigational: 0 };
    const domains = organic.map((result) => {
        try {
            return new URL(result.url).hostname.replace('www.', '');
        } catch {
            return '';
        }
    });

    const tier1 = ['amazon', 'youtube', 'reddit', 'pinterest', 'quora', 'facebook', 'instagram', 'linkedin', 'twitter', 'tiktok', 'medium'];
    const tier2 = ['forbes', 'nytimes', 'healthline', 'investopedia', 'hubspot', 'g2', 'capterra', 'techcrunch', 'theverge', 'cnn', 'bbc', 'webmd'];
    let brandScore = 0;
    const domainTypes = { tier1: 0, tier2: 0, indie: 0 };

    domains.forEach((domain) => {
        if (tier1.some((brand) => domain.includes(brand))) {
            brandScore += 3;
            domainTypes.tier1 += 1;
        } else if (tier2.some((brand) => domain.includes(brand))) {
            brandScore += 2;
            domainTypes.tier2 += 1;
        } else {
            brandScore += 1;
            domainTypes.indie += 1;
        }
    });

    const maxScore = organic.length * 3;
    const brandPressure = Math.round((brandScore / maxScore) * 100);

    organic.forEach((result) => {
        const text = `${result.title} ${result.snippet}`.toLowerCase();
        if (/\d{1,2} (jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec) \d{4}/i.test(result.snippet)
            || /\d+ (days?|hours?|mins?) ago/i.test(result.snippet)) {
            totalDateCount += 1;
        }

        if (text.includes('best') || text.includes('top ') || text.includes('review') || text.includes(' vs ')) {
            types.listicle += 1;
        } else if (text.includes('buy') || text.includes('shop') || text.includes('price') || text.includes('sale') || text.includes('cart')) {
            types.transactional += 1;
        } else if (text.includes('how to') || text.includes('guide') || text.includes('tutorial') || text.includes('what is')) {
            types.informational += 1;
        } else {
            types.informational += 1;
        }
    });

    let avgWords = 0;
    try {
        const topThree = organic.slice(0, 3);
        const counts = await Promise.all(topThree.map((result) => getQuickWordCount(result.url)));
        const validCounts = counts.filter((count) => count !== null);
        if (validCounts.length > 0) {
            avgWords = Math.round(validCounts.reduce((sum, count) => sum + count, 0) / validCounts.length);
        }
    } catch {
        // Keep heuristic fallback.
    }

    const dominantType = Object.keys(types).reduce((left, right) => (types[left] > types[right] ? left : right));
    const sortedTypes = Object.entries(types).sort((left, right) => right[1] - left[1]);
    const secondaryType = sortedTypes[1]?.[0] || 'none';
    const confidence = (types[dominantType] / organic.length).toFixed(2);

    let freshnessDir = 'Irrelevant';
    if (totalDateCount > 5) freshnessDir = 'Required';
    else if (totalDateCount > 2) freshnessDir = 'Optional';

    const autocompleteDensity = Math.min((suggestions.length / 15) * 25, 25);
    let featureCount = 0;
    organic.forEach((result) => {
        const snippet = result.snippet.toLowerCase();
        if (snippet.includes('rating') || snippet.includes('star') || snippet.includes('vote') || snippet.includes('review') || result.title.toLowerCase().includes('video')) {
            featureCount += 1;
        }
    });

    const serpFeaturesScore = Math.min((featureCount / 5) * 25, 25);
    const trendDirection = Math.min((totalDateCount / 6) * 25, 25);
    let ugcCount = 0;
    const ugcDomains = ['reddit', 'quora', 'pinterest', 'medium', 'youtube', 'tiktok', 'facebook', 'instagram', 'twitter', 'linkedin'];
    domains.forEach((domain) => {
        if (ugcDomains.some((ugcDomain) => domain.includes(ugcDomain))) {
            ugcCount += 1;
        }
    });

    const ugcFrequency = Math.min((ugcCount / 3) * 25, 25);
    const volumeScore = Math.round(autocompleteDensity + serpFeaturesScore + trendDirection + ugcFrequency);

    return {
        dominantPageType: dominantType,
        secondaryPageType: secondaryType,
        typeConfidence: confidence,
        brandPressureIndex: brandPressure,
        domainTypes,
        domains: [...new Set(domains)],
        avgContentLength: avgWords > 0 ? `${avgWords} words (est.)` : (dominantType === 'informational' ? 'Long Form (Inf)' : 'Short (Inf)'),
        avgWordCount: avgWords,
        freshness: freshnessDir,
        intentClarity: types[dominantType] >= (organic.length * 0.6) ? 'Clear' : 'Mixed',
        volumeScore,
        volumeBreakdown: {
            autocompleteDensity: Math.round(autocompleteDensity),
            serpFeatures: Math.round(serpFeaturesScore),
            trendDirection: Math.round(trendDirection),
            ugcFrequency: Math.round(ugcFrequency),
        },
    };
}

async function layer2SerpDna(seed, serpData, serpSummary, suggestions, groundedSearch, options = {}) {
    console.log(`[Layer 2] SERP DNA Intelligence for: ${seed}`);

    const prompt = `
You are a SERP Forensics Analyst with 15 years of experience.

TASK: Analyze the SERP landscape for the seed keyword "${seed}" and produce a SERP DNA Profile.

DATA PROVIDED:
- Seed keyword: "${seed}"
- SERP Results (top 10): ${JSON.stringify(serpData.organic.slice(0, 10))}
- People Also Ask: ${JSON.stringify(serpData.paaQuestions)}
- Related Searches: ${JSON.stringify(serpData.relatedSearches)}
- Knowledge Graph: ${JSON.stringify(serpData.knowledgeGraph)}
- SERP Features Detected: ${JSON.stringify(serpData.serpFeatures)}
- Autocomplete Suggestions: ${JSON.stringify(suggestions.slice(0, 20))}
- Heuristic Summary: ${JSON.stringify(serpSummary)}
- Grounded Search Verification: ${JSON.stringify(groundedSearch)}

Think deeply about:
1. What is Google's ideal result for this query?
2. What E-E-A-T signals are present in the top results?
3. What content patterns dominate?
4. Where are the gaps in the current SERP?
5. What topical authority signals does Google require?

OUTPUT STYLE:
- Keep the output concise and card-friendly.
- "googleWants", "topicalAuthority", "rankerProfile", and "opportunityAngle" must each be one short sentence, max 18 words.
- Each E-E-A-T value must be max 10 words.
- "contentFormatDominance" must contain at most 4 items, 1-3 words each.
- "contentGaps" must contain at most 4 items, max 12 words each.

Return this exact JSON schema:
{
  "serpPersonality": "Knowledge Hub | Commercial Battlefield | Tutorial Playground | News Feed | Community Forum | Mixed Bazaar",
  "googleWants": "string",
  "contentFormatDominance": ["string"],
  "eatSignals": {
    "experience": "string",
    "expertise": "string",
    "authority": "string",
    "trust": "string"
  },
  "topicalAuthority": "string",
  "contentGaps": ["string"],
  "rankerProfile": "string",
  "difficultyVerdict": "Easy Pickings | Moderate Fight | Tough Battle | Near Impossible",
  "opportunityAngle": "string"
}`;

    try {
        const response = await generateJson({
            modelType: 'keyword',
            preferredBackend: options.preferredBackend || BACKEND_VERTEX,
            taskName: 'SERP DNA analysis',
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 8192 },
            },
            onEvent: createProviderEventHandler({
                onProgress: options.onProgress,
                layer: 2,
                label: 'SERP DNA analysis',
            }),
        });

        return { data: response.data, meta: response };
    } catch (error) {
        console.error('[Layer 2] Error:', error.message);
        return {
            data: {
                serpPersonality: 'Mixed Bazaar',
                googleWants: 'Unable to determine due to analysis error.',
                contentFormatDominance: ['unknown'],
                eatSignals: { experience: 'N/A', expertise: 'N/A', authority: 'N/A', trust: 'N/A' },
                topicalAuthority: 'Unable to determine',
                contentGaps: [],
                rankerProfile: 'Unknown',
                difficultyVerdict: 'Unknown',
                opportunityAngle: 'Retry analysis with more data.',
            },
            meta: null,
        };
    }
}

async function layer3IntentDecomposition(seed, serpData, serpDna, suggestions, groundedSearch, options = {}) {
    console.log(`[Layer 3] Intent Decomposition for: ${seed}`);

    const prompt = `
You are a Search Intent Psychologist specializing in user behavior analysis.

TASK: Decompose the search intent for "${seed}" across multiple dimensions.

CONTEXT:
- SERP DNA Profile: ${JSON.stringify(serpDna)}
- People Also Ask: ${JSON.stringify(serpData.paaQuestions)}
- Related Searches: ${JSON.stringify(serpData.relatedSearches)}
- Autocomplete: ${JSON.stringify(suggestions.slice(0, 20))}
- Grounded Search Verification: ${JSON.stringify(groundedSearch)}

Think deeply about:
1. The full spectrum of why someone searches for "${seed}".
2. Where they are in the buyer journey.
3. What micro-intents exist beneath the surface query.
4. How intent shifts based on modifiers and context.

OUTPUT STYLE:
- Keep the output concise and dashboard-friendly.
- "primaryIntent" must be 1-3 words.
- "intentInsight" must be one short sentence, max 18 words.
- "contentAngle" must be max 10 words.
- "microIntents" must contain at most 4 items.
- Each micro-intent "intent" must be max 4 words and "example_query" max 6 words.

Return this exact JSON schema:
{
  "primaryIntent": "string",
  "intentSpectrum": {
    "know": 0,
    "do": 0,
    "go": 0,
    "buy": 0,
    "compare": 0,
    "learn": 0
  },
  "buyerJourney": {
    "awareness": 0,
    "consideration": 0,
    "decision": 0,
    "retention": 0
  },
  "microIntents": [
    {
      "intent": "string",
      "strength": "High | Medium | Low",
      "example_query": "string"
    }
  ],
  "intentInsight": "string",
  "contentAngle": "string"
}`;

    try {
        const response = await generateJson({
            modelType: 'keyword',
            preferredBackend: options.preferredBackend || BACKEND_VERTEX,
            taskName: 'intent decomposition',
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 8192 },
            },
            onEvent: createProviderEventHandler({
                onProgress: options.onProgress,
                layer: 3,
                label: 'intent decomposition',
            }),
        });

        return { data: response.data, meta: response };
    } catch (error) {
        console.error('[Layer 3] Error:', error.message);
        return {
            data: {
                primaryIntent: 'Informational',
                intentSpectrum: { know: 50, do: 20, go: 5, buy: 10, compare: 10, learn: 5 },
                buyerJourney: { awareness: 40, consideration: 30, decision: 20, retention: 10 },
                microIntents: [],
                intentInsight: 'Unable to perform deep intent analysis.',
                contentAngle: 'Focus on comprehensive coverage.',
            },
            meta: null,
        };
    }
}

async function layer4KeywordUniverse(seed, serpData, serpDna, intentData, suggestions, groundedSearch, options = {}) {
    console.log(`[Layer 4] Keyword Universe Expansion for: ${seed}`);

    const prompt = `
You are a Keyword Strategist who merges data science with SEO expertise.

TASK: Build a comprehensive keyword universe for "${seed}" using only the data provided.

DATA PROVIDED:
- Autocomplete suggestions: ${JSON.stringify(suggestions)}
- People Also Ask: ${JSON.stringify(serpData.paaQuestions.map((question) => question.question))}
- Related Searches: ${JSON.stringify(serpData.relatedSearches)}
- SERP titles/snippets: ${JSON.stringify(serpData.organic.slice(0, 10).map((result) => ({ title: result.title, snippet: result.snippet })))}
- SERP DNA: ${JSON.stringify(serpDna)}
- Intent Analysis: ${JSON.stringify(intentData)}
- Grounded Search Verification: ${JSON.stringify(groundedSearch)}

RULES:
1. Use only keywords visible in the provided data or semantically implied by titles/snippets.
2. You may generate long-tail variations of visible keywords.
3. Classify every keyword with intent and opportunity score.
4. Opportunity score = (relevance * intent alignment) / estimated difficulty on a 1-100 scale.
5. Limit total keywords to 40-60.

Return this exact JSON schema:
{
  "totalKeywords": 0,
  "keywords": [
    {
      "term": "string",
      "intent": "Informational | Commercial | Transactional | Navigational | Comparison",
      "volume": "High | Medium | Low",
      "difficulty": "Easy | Medium | Hard",
      "opportunityScore": 0,
      "source": "autocomplete | paa | related | serp_implied | long_tail",
      "buyerStage": "Awareness | Consideration | Decision | Retention"
    }
  ],
  "questionKeywords": [
    {
      "question": "string",
      "intent": "string",
      "volume": "High | Medium | Low"
    }
  ],
  "lsiTerms": ["string"],
  "longTailGems": [
    {
      "term": "string",
      "reason": "string",
      "opportunityScore": 0
    }
  ]
}`;

    try {
        const response = await generateJson({
            modelType: 'keyword',
            preferredBackend: options.preferredBackend || BACKEND_VERTEX,
            taskName: 'keyword universe expansion',
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 16384 },
            },
            onEvent: createProviderEventHandler({
                onProgress: options.onProgress,
                layer: 4,
                label: 'keyword expansion',
            }),
        });

        return { data: response.data, meta: response };
    } catch (error) {
        console.error('[Layer 4] Error:', error.message);
        return {
            data: {
                totalKeywords: 0,
                keywords: [],
                questionKeywords: [],
                lsiTerms: [],
                longTailGems: [],
            },
            meta: null,
        };
    }
}

async function layer5StrategicSynthesis(seed, serpDna, intentData, keywordUniverse, serpSummary, groundedSearch, options = {}) {
    console.log(`[Layer 5] Strategic Synthesis for: ${seed}`);

    const prompt = `
You are the Chief SEO Strategist producing the final actionable intelligence report.

TASK: Synthesize all previous analysis layers into a prioritized action plan for "${seed}".

ANALYSIS INPUTS:
- SERP DNA Profile: ${JSON.stringify(serpDna)}
- Intent Decomposition: ${JSON.stringify(intentData)}
- Keyword Universe (${keywordUniverse.totalKeywords} keywords): ${JSON.stringify(keywordUniverse.keywords?.slice(0, 30))}
- Long-tail gems: ${JSON.stringify(keywordUniverse.longTailGems)}
- Question keywords: ${JSON.stringify(keywordUniverse.questionKeywords)}
- Heuristic Summary: ${JSON.stringify(serpSummary)}
- Grounded Search Verification: ${JSON.stringify(groundedSearch)}

Think deeply to produce the most actionable, realistic strategy. Avoid optimism bias and be honest about difficulty and timeline.

OUTPUT STYLE:
- Write like an operator brief, not an essay.
- "difficulty.reason", each viability "reason", "contentGap", and "alternativeStrategy.reason" must be one short sentence, max 18 words.
- "contentBlueprint.uniqueAngle" must be max 14 words.
- "clusters" must contain at most 4 items and each cluster should include at most 5 keywords.
- "quickWins" must contain at most 4 items.
- Each quick win "reason" and "action" must be max 12 words.
- "mustInclude" and "avoid" must each contain at most 5 short items, 2-6 words each.
- "alternativeStrategy.keywords" must contain at most 4 items.
- "executionPriority" must contain at most 5 items, max 10 words each.

Return this exact JSON schema:
{
  "difficulty": {
    "score": 0,
    "label": "Easy | Moderate | Hard | Very Hard | Near Impossible",
    "reason": "string"
  },
  "viability": {
    "soloCreator": { "verdict": "High | Medium | Low", "reason": "string" },
    "smallBusiness": { "verdict": "High | Medium | Low", "reason": "string" },
    "brand": { "verdict": "High | Medium | Low", "reason": "string" }
  },
  "clusters": [
    {
      "name": "string",
      "priority": "P0 | P1 | P2 | P3",
      "intent": "string",
      "keywords": [
        { "term": "string", "intent": "string", "volume": "string", "opportunityScore": 0 }
      ],
      "contentFormat": "string",
      "estimatedTraffic": "High | Medium | Low"
    }
  ],
  "quickWins": [
    {
      "keyword": "string",
      "reason": "string",
      "action": "string",
      "timeToRank": "string"
    }
  ],
  "contentBlueprint": {
    "primaryFormat": "string",
    "wordCountTarget": "string",
    "uniqueAngle": "string",
    "mustInclude": ["string"],
    "avoid": ["string"],
    "timeToImpact": "string",
    "confidence": "High | Medium | Low"
  },
  "alternativeStrategy": {
    "angle": "string",
    "reason": "string",
    "keywords": ["string"]
  },
  "contentGap": "string",
  "executionPriority": ["string"]
}`;

    try {
        const response = await generateJson({
            modelType: 'keyword',
            preferredBackend: options.preferredBackend || BACKEND_VERTEX,
            taskName: 'strategic synthesis',
            contents: prompt,
            config: {
                temperature: 0.2,
                maxOutputTokens: 65536,
                thinkingConfig: { thinkingBudget: 16384 },
            },
            onEvent: createProviderEventHandler({
                onProgress: options.onProgress,
                layer: 5,
                label: 'strategic synthesis',
            }),
        });

        return { data: response.data, meta: response };
    } catch (error) {
        console.error('[Layer 5] Error:', error.message);
        return {
            data: {
                difficulty: { score: 0, label: 'Unknown', reason: 'Analysis failed' },
                viability: {
                    soloCreator: { verdict: 'Unknown', reason: 'Analysis failed' },
                    smallBusiness: { verdict: 'Unknown', reason: 'Analysis failed' },
                    brand: { verdict: 'Unknown', reason: 'Analysis failed' },
                },
                clusters: [],
                quickWins: [],
                contentBlueprint: {
                    primaryFormat: 'Unknown',
                    wordCountTarget: 'Unknown',
                    uniqueAngle: 'Unknown',
                    mustInclude: [],
                    avoid: [],
                    timeToImpact: 'Unknown',
                    confidence: 'Low',
                },
                alternativeStrategy: { angle: 'Retry', reason: 'Analysis failed', keywords: [] },
                contentGap: 'Analysis failed',
                executionPriority: [],
            },
            meta: null,
        };
    }
}

async function analyzeWithAi(seed, suggestions, serpResults, serpSummary, options = {}) {
    const serpContext = serpResults.length > 0
        ? JSON.stringify(serpResults.slice(0, 5))
        : 'No live SERP data available. Rely on your internal knowledge of this topic.';
    const summaryContext = serpSummary
        ? JSON.stringify(serpSummary, null, 2)
        : 'No automated SERP summary available.';

    const prompt = `You are a SERP Feasibility Analyst. Analyze "${seed}".
Autocomplete: ${JSON.stringify(suggestions.slice(0, 15))}
SERP: ${serpContext}
Summary: ${summaryContext}
Return valid JSON with: difficulty, viability, recommendedStrategy, alternativeStrategy, clusters, contentGap.`;

    const response = await generateJson({
        modelType: 'keyword',
        preferredBackend: options.preferredBackend || BACKEND_VERTEX,
        taskName: 'legacy keyword analysis',
        contents: prompt,
        config: {
            temperature: 0.8,
            maxOutputTokens: 8192,
        },
        onEvent: createProviderEventHandler({
            onProgress: options.onProgress,
            layer: 5,
            label: 'legacy keyword analysis',
        }),
    });

    return { data: response.data, meta: response };
}

async function runKeywordResearchV2(seedInput, options = {}) {
    const seed = normalizeSeed(seedInput);
    if (!seed) {
        throw new Error('Seed keyword required');
    }

    let lastAiMeta = null;
    let groundedSearchSkippedReason = null;
    let groundedSearchQuota = null;
    const keywordAdsRequested = options.useAdsData === true;
    const keywordAdsProviderConfig = getPreferredKeywordAdsProviderConfig();
    let keywordAdsMeta = {
        requested: keywordAdsRequested,
        provider: keywordAdsProviderConfig.provider,
        providerLabel: keywordAdsProviderConfig.providerLabel,
        configured: false,
        configurationReason: keywordAdsProviderConfig.reason || null,
        featureEnabled: false,
        allowed: false,
        unlimited: false,
        cacheHit: false,
        enriched: false,
        usageApplied: false,
        skippedReason: keywordAdsRequested ? null : 'not_requested',
        weeklyLimit: null,
        usedThisWeek: 0,
        remainingThisWeek: null,
        locationCode: keywordAdsProviderConfig.locationCode ?? null,
        languageCode: keywordAdsProviderConfig.languageCode ?? '',
        searchPartners: keywordAdsProviderConfig.searchPartners ?? false,
        taskCost: 0,
        taskKeywords: [],
        enrichedKeywordCount: 0,
    };

    await pushProgress(options.onProgress, {
        stage: 'Queued',
        label: 'Queued',
        currentLayer: 0,
        totalLayers: TOTAL_LAYERS,
        completed: 0,
        total: TOTAL_LAYERS,
        percent: 0,
        message: `Queued keyword research for "${seed}"`,
        provider: getRuntimeProviderLabel(),
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ADVANCED KEYWORD INTELLIGENCE: "${seed}"`);
    console.log(`${'='.repeat(60)}\n`);

    await pushProgress(options.onProgress, buildProgressUpdate(1, 'Collecting autocomplete suggestions and live SERP data...', {
        phase: 'start',
    }));

    const [suggestions, serpData] = await Promise.all([
        fetchAutocomplete(seed),
        fetchSERP(seed),
    ]);
    const groundedSearchRequested = shouldUseGroundedSearchFallback(suggestions, serpData);

    let groundedSearch = null;

    await pushProgress(options.onProgress, buildProgressUpdate(1, `Fetched ${suggestions.length} autocomplete ideas and ${serpData.organic.length} top SERP results.`, {
        phase: 'mid',
    }));

    if (groundedSearchRequested) {
        await pushProgress(options.onProgress, buildProgressUpdate(1, 'Live keyword signals are thin. Verifying the query with Google Search grounding...', {
            phase: 'mid',
        }));

        groundedSearchQuota = await reserveGroundedSearchUsage({
            limit: options.groundedSearchDailyLimit,
        });

        if (!groundedSearchQuota.allowed) {
            groundedSearchSkippedReason = groundedSearchQuota.reason;
            if (groundedSearchQuota.reason === 'daily_limit_reached') {
                await pushProgress(options.onProgress, buildProgressUpdate(1, `Google Search grounding skipped: daily limit reached (${groundedSearchQuota.limit}/day).`, {
                    phase: 'mid',
                }));
            } else {
                await pushProgress(options.onProgress, buildProgressUpdate(1, 'Google Search grounding skipped because quota tracking is unavailable.', {
                    phase: 'mid',
                }));
            }
        } else {
            try {
                const groundedSearchResponse = await fetchGroundedSearchSnapshot(seed, options);
                groundedSearch = groundedSearchResponse.data;
                lastAiMeta = groundedSearchResponse.meta || lastAiMeta;
            } catch (error) {
                groundedSearchSkippedReason = 'request_failed';
                console.error('[Grounded Search] Error:', error.message);
            }
        }
    }

    if (!hasUsableKeywordSourceData(suggestions, serpData, groundedSearch)) {
        throw new Error(`Keyword research stopped because no reliable search data was available for "${seed}".`);
    }

    const serpSummary = await analyzeSERP(serpData.organic, suggestions);

    await pushProgress(options.onProgress, buildProgressUpdate(1, `Layer 1 complete. ${serpData.paaQuestions.length} People Also Ask prompts and ${serpData.relatedSearches.length} related searches captured.`, {
        phase: 'complete',
    }));

    await pushProgress(options.onProgress, buildProgressUpdate(2, 'Mapping SERP DNA and authority patterns...', {
        phase: 'start',
    }));
    const serpDnaResponse = await layer2SerpDna(seed, serpData, serpSummary, suggestions, groundedSearch, options);
    const serpDna = normalizeSerpDna(serpDnaResponse.data);
    lastAiMeta = serpDnaResponse.meta || lastAiMeta;
    await pushProgress(options.onProgress, buildProgressUpdate(2, `Layer 2 complete. SERP personality: ${serpDna.serpPersonality}.`, {
        phase: 'complete',
        provider: serpDnaResponse.meta?.provider || getRuntimeProviderLabel(),
    }));

    await pushProgress(options.onProgress, buildProgressUpdate(3, 'Decomposing user intent and buyer journey signals...', {
        phase: 'start',
        provider: serpDnaResponse.meta?.provider || getRuntimeProviderLabel(),
    }));
    const intentResponse = await layer3IntentDecomposition(seed, serpData, serpDna, suggestions, groundedSearch, options);
    const intentData = normalizeIntentDecomposition(intentResponse.data);
    lastAiMeta = intentResponse.meta || lastAiMeta;
    await pushProgress(options.onProgress, buildProgressUpdate(3, `Layer 3 complete. Primary intent: ${intentData.primaryIntent}.`, {
        phase: 'complete',
        provider: intentResponse.meta?.provider || getRuntimeProviderLabel(),
    }));

    await pushProgress(options.onProgress, buildProgressUpdate(4, 'Expanding the keyword universe and scoring opportunities...', {
        phase: 'start',
        provider: intentResponse.meta?.provider || getRuntimeProviderLabel(),
    }));
    const keywordUniverseResponse = await layer4KeywordUniverse(seed, serpData, serpDna, intentData, suggestions, groundedSearch, options);
    const keywordContext = {
        suggestions,
        serpData,
        groundedSearch,
        serpSummary,
        serpDna,
        intentData,
    };
    let keywordUniverse = rescoreKeywordUniverse(normalizeKeywordUniverse(keywordUniverseResponse.data), keywordContext);
    lastAiMeta = keywordUniverseResponse.meta || lastAiMeta;

    if (keywordAdsRequested) {
        const adsStatus = await getKeywordAdsUsageStatus(options.user || null);
        keywordAdsMeta = {
            ...keywordAdsMeta,
            provider: adsStatus.provider,
            providerLabel: adsStatus.providerLabel,
            configured: adsStatus.configured,
            configurationReason: adsStatus.configurationReason || null,
            featureEnabled: adsStatus.featureEnabled,
            allowed: adsStatus.allowed,
            unlimited: adsStatus.unlimited,
            skippedReason: adsStatus.reason,
            weeklyLimit: adsStatus.weeklyLimit,
            usedThisWeek: adsStatus.usedThisWeek,
            remainingThisWeek: adsStatus.remainingThisWeek,
            locationCode: adsStatus.locationCode ?? keywordAdsMeta.locationCode,
            languageCode: adsStatus.languageCode || keywordAdsMeta.languageCode,
            searchPartners: typeof adsStatus.searchPartners === 'boolean' ? adsStatus.searchPartners : keywordAdsMeta.searchPartners,
        };

        if (adsStatus.configured && adsStatus.featureEnabled) {
            await pushProgress(options.onProgress, buildProgressUpdate(4, `Checking cached ${keywordAdsMeta.providerLabel} enrichment for this keyword set...`, {
                phase: 'mid',
                provider: keywordAdsMeta.providerLabel,
            }));

            const cachedAds = await getCachedKeywordAdsSnapshot(seed, {
                provider: keywordAdsMeta.provider,
                locationCode: keywordAdsMeta.locationCode,
                languageCode: keywordAdsMeta.languageCode,
                searchPartners: keywordAdsMeta.searchPartners,
            });

            if (cachedAds?.payload) {
                keywordUniverse = mergeKeywordAdsData(keywordUniverse, cachedAds.payload, keywordContext);
                keywordAdsMeta = {
                    ...keywordAdsMeta,
                    cacheHit: true,
                    enriched: true,
                    skippedReason: 'cache_hit',
                    taskCost: Number(cachedAds.payload.cost || 0),
                    taskKeywords: Array.isArray(cachedAds.payload.taskKeywords) ? cachedAds.payload.taskKeywords : [],
                    enrichedKeywordCount: keywordUniverse.keywords.filter((keyword) => keyword.adsMetrics).length,
                };
            } else if (adsStatus.allowed || adsStatus.unlimited) {
                const reservedUsage = await reserveKeywordAdsUsage(options.user || null);
                keywordAdsMeta = {
                    ...keywordAdsMeta,
                    allowed: reservedUsage.allowed,
                    unlimited: reservedUsage.unlimited,
                    usageApplied: reservedUsage.usageApplied,
                    skippedReason: reservedUsage.reason,
                    usedThisWeek: reservedUsage.usedThisWeek,
                    remainingThisWeek: reservedUsage.remainingThisWeek,
                };

                if (reservedUsage.allowed) {
                    await pushProgress(options.onProgress, buildProgressUpdate(4, `Pulling Google Ads keyword data from ${keywordAdsMeta.providerLabel}...`, {
                        phase: 'mid',
                        provider: keywordAdsMeta.providerLabel,
                    }));

                    try {
                        const adsSnapshot = await fetchLiveKeywordAdsSnapshot(seed, {
                            suggestions,
                            serpData,
                            keywordUniverse,
                        }, {
                            providerConfig: keywordAdsProviderConfig,
                            provider: keywordAdsMeta.provider,
                            locationCode: keywordAdsMeta.locationCode,
                            languageCode: keywordAdsMeta.languageCode,
                            searchPartners: keywordAdsMeta.searchPartners,
                            tag: `keyword-research:${seed}`,
                        });

                        await saveKeywordAdsSnapshot(seed, adsSnapshot, {
                            provider: keywordAdsMeta.provider,
                            locationCode: keywordAdsMeta.locationCode,
                            languageCode: keywordAdsMeta.languageCode,
                            searchPartners: keywordAdsMeta.searchPartners,
                        });

                        keywordUniverse = mergeKeywordAdsData(keywordUniverse, adsSnapshot, keywordContext);
                        keywordAdsMeta = {
                            ...keywordAdsMeta,
                            enriched: true,
                            skippedReason: null,
                            taskCost: Number(adsSnapshot.cost || 0),
                            taskKeywords: adsSnapshot.taskKeywords || [],
                            enrichedKeywordCount: keywordUniverse.keywords.filter((keyword) => keyword.adsMetrics).length,
                        };
                    } catch (error) {
                        let releasedUsage = null;
                        if (reservedUsage.usageApplied) {
                            releasedUsage = await releaseKeywordAdsUsage(options.user || null, {
                                weekKey: reservedUsage.weekKey,
                            });
                        }

                        keywordAdsMeta = {
                            ...keywordAdsMeta,
                            allowed: releasedUsage?.allowed ?? keywordAdsMeta.allowed,
                            usageApplied: releasedUsage?.usageReleased ? false : keywordAdsMeta.usageApplied,
                            usedThisWeek: releasedUsage?.usedThisWeek ?? keywordAdsMeta.usedThisWeek,
                            remainingThisWeek: releasedUsage?.remainingThisWeek ?? keywordAdsMeta.remainingThisWeek,
                            skippedReason: 'request_failed',
                        };
                        console.error('[Keyword Ads] Error:', error.message);
                    }
                }
            }
        }
    }

    await pushProgress(options.onProgress, buildProgressUpdate(4, `Layer 4 complete. ${keywordUniverse.totalKeywords} keywords surfaced for prioritization.`, {
        phase: 'complete',
        provider: keywordUniverseResponse.meta?.provider || getRuntimeProviderLabel(),
    }));

    await pushProgress(options.onProgress, buildProgressUpdate(5, 'Synthesizing the strategy and execution plan...', {
        phase: 'start',
        provider: keywordUniverseResponse.meta?.provider || getRuntimeProviderLabel(),
    }));
    const strategyResponse = await layer5StrategicSynthesis(seed, serpDna, intentData, keywordUniverse, serpSummary, groundedSearch, options);
    const strategy = normalizeStrategicSynthesis(strategyResponse.data);
    lastAiMeta = strategyResponse.meta || lastAiMeta;
    await pushProgress(options.onProgress, buildProgressUpdate(5, `Layer 5 complete. Difficulty scored at ${strategy.difficulty.score}/100.`, {
        phase: 'complete',
        provider: strategyResponse.meta?.provider || getRuntimeProviderLabel(),
        percent: 100,
    }));

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  PIPELINE COMPLETE for "${seed}"`);
    console.log(`${'='.repeat(60)}\n`);

    return {
        seed,
        projectId: options.projectId || null,
        serp: serpData.organic,
        serpRaw: {
            paaQuestions: serpData.paaQuestions,
            relatedSearches: serpData.relatedSearches,
            knowledgeGraph: serpData.knowledgeGraph,
            serpFeatures: serpData.serpFeatures,
            totalResults: serpData.totalResults,
        },
        groundedSearch,
        serpSummary,
        serpDna,
        intentData,
        keywordUniverse,
        strategy,
        analysis: buildAnalysisMapping(strategy),
        metadata: {
            ...buildMetadata(lastAiMeta),
            groundedSearchRequested,
            groundedSearchUsed: Boolean(groundedSearch),
            groundedSearchSkippedReason,
            keywordAds: keywordAdsMeta,
            groundedSearchQuota: groundedSearchQuota
                ? {
                    date: groundedSearchQuota.date,
                    limit: groundedSearchQuota.limit,
                    used: groundedSearchQuota.used,
                    remaining: groundedSearchQuota.remaining,
                }
                : null,
        },
    };
}

async function runLegacyKeywordResearch(seedInput, options = {}) {
    const seed = normalizeSeed(seedInput);
    if (!seed) {
        throw new Error('Seed keyword required');
    }

    console.log(`Starting Legacy Research for: ${seed}`);

    const [suggestions, serpData] = await Promise.all([
        fetchAutocomplete(seed),
        fetchSERP(seed),
    ]);

    const serpSummary = await analyzeSERP(serpData.organic, suggestions);
    const analysisResponse = await analyzeWithAi(seed, suggestions, serpData.organic, serpSummary, options);

    return {
        seed,
        projectId: options.projectId || null,
        serp: serpData.organic,
        serpSummary,
        analysis: analysisResponse.data,
        metadata: buildMetadata(analysisResponse.meta),
    };
}

module.exports = {
    TOTAL_LAYERS,
    getRuntimeProviderLabel,
    runKeywordResearchV2,
    runLegacyKeywordResearch,
    __internal: {
        applyGroundedSearchUsageLimit,
        getGroundingDateKey,
        normalizeSerpDna,
        normalizeIntentDecomposition,
        normalizeKeywordUniverse,
        normalizeStrategicSynthesis,
        buildAnalysisMapping,
    },
};
