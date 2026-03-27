const crypto = require('node:crypto');
const axios = require('axios');

const { KeywordAdsCache } = require('./models');

const DATAFORSEO_ENDPOINT = 'https://api.dataforseo.com/v3/keywords_data/google_ads/keywords_for_keywords/live';
const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = 'en';
const DEFAULT_CACHE_TTL_DAYS = 30;
const MAX_TASK_KEYWORDS = 20;
const MAX_STORED_RESULTS = 500;

function parseInteger(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function parseBoolean(value, fallback = false) {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value !== 'string') {
        return fallback;
    }

    if (/^(1|true|yes|on)$/i.test(value)) {
        return true;
    }

    if (/^(0|false|no|off)$/i.test(value)) {
        return false;
    }

    return fallback;
}

function getLocationCode() {
    return parseInteger(process.env.DATAFORSEO_ADS_LOCATION_CODE, DEFAULT_LOCATION_CODE);
}

function getLanguageCode() {
    const value = String(process.env.DATAFORSEO_ADS_LANGUAGE_CODE || DEFAULT_LANGUAGE_CODE).trim().toLowerCase();
    return value || DEFAULT_LANGUAGE_CODE;
}

function getSearchPartners() {
    return parseBoolean(process.env.DATAFORSEO_ADS_SEARCH_PARTNERS, false);
}

function getCacheTtlDays() {
    return Math.max(1, parseInteger(process.env.DATAFORSEO_ADS_CACHE_TTL_DAYS, DEFAULT_CACHE_TTL_DAYS));
}

function getAuthConfig() {
    return {
        login: String(process.env.DATAFORSEO_LOGIN || '').trim(),
        password: String(process.env.DATAFORSEO_PASSWORD || '').trim(),
    };
}

function normalizeKeywordText(value) {
    return String(value || '')
        .replace(/[^0-9a-zA-Z\s&+/\-.'()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .slice(0, 80);
}

function isQuestionLikeKeyword(value) {
    return /^(what|why|how|who|when|where|can|is|are|does|do|should)\b/i.test(String(value || '').trim());
}

function collectUniqueKeywords(values, limit = MAX_TASK_KEYWORDS) {
    const results = [];
    const seen = new Set();

    for (const entry of values || []) {
        const keyword = normalizeKeywordText(entry);
        if (!keyword || seen.has(keyword) || isQuestionLikeKeyword(keyword)) {
            continue;
        }
        seen.add(keyword);
        results.push(keyword);
        if (results.length >= limit) {
            break;
        }
    }

    return results;
}

function buildAdsSeedKeywords({ seed, suggestions = [], serpData = {}, keywordUniverse = {} }) {
    const prioritizedUniverse = Array.isArray(keywordUniverse.keywords)
        ? [...keywordUniverse.keywords]
            .sort((left, right) => (Number(right?.opportunityScore || 0) - Number(left?.opportunityScore || 0)))
            .map((keyword) => keyword?.term)
        : [];
    const longTailGems = Array.isArray(keywordUniverse.longTailGems)
        ? keywordUniverse.longTailGems.map((item) => item?.term)
        : [];
    const relatedSearches = Array.isArray(serpData.relatedSearches) ? serpData.relatedSearches : [];

    return collectUniqueKeywords([
        seed,
        ...prioritizedUniverse,
        ...suggestions,
        ...relatedSearches,
        ...longTailGems,
    ]);
}

function buildAdsCacheKey(seed, options = {}) {
    const rawKey = JSON.stringify({
        seed: normalizeKeywordText(seed),
        locationCode: options.locationCode ?? getLocationCode(),
        languageCode: options.languageCode ?? getLanguageCode(),
        searchPartners: options.searchPartners ?? getSearchPartners(),
    });

    return crypto.createHash('sha256').update(rawKey).digest('hex');
}

async function getCachedKeywordAdsSnapshot(seed, options = {}) {
    const cacheKey = buildAdsCacheKey(seed, options);
    const cached = await KeywordAdsCache.findOne({
        cacheKey,
        expiresAt: { $gt: new Date() },
    }).lean();

    return cached || null;
}

async function saveKeywordAdsSnapshot(seed, payload, options = {}) {
    const now = new Date();
    const ttlDays = options.cacheTtlDays || getCacheTtlDays();
    const expiresAt = new Date(now.getTime() + ttlDays * 24 * 60 * 60 * 1000);
    const cacheKey = buildAdsCacheKey(seed, options);

    await KeywordAdsCache.findOneAndUpdate(
        { cacheKey },
        {
            cacheKey,
            seed: normalizeKeywordText(seed),
            locationCode: options.locationCode ?? getLocationCode(),
            languageCode: options.languageCode ?? getLanguageCode(),
            searchPartners: options.searchPartners ?? getSearchPartners(),
            payload,
            expiresAt,
        },
        {
            upsert: true,
            new: true,
            setDefaultsOnInsert: true,
        }
    );
}

function asNullableNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function mapAdsResult(entry) {
    const keyword = normalizeKeywordText(entry?.keyword);
    if (!keyword) {
        return null;
    }

    return {
        keyword,
        competition: typeof entry?.competition === 'string' ? entry.competition.toUpperCase() : null,
        competitionIndex: asNullableNumber(entry?.competition_index),
        searchVolume: asNullableNumber(entry?.search_volume),
        lowTopOfPageBid: asNullableNumber(entry?.low_top_of_page_bid),
        highTopOfPageBid: asNullableNumber(entry?.high_top_of_page_bid),
        cpc: asNullableNumber(entry?.cpc),
        monthlySearches: Array.isArray(entry?.monthly_searches)
            ? entry.monthly_searches
                .map((month) => ({
                    year: asNullableNumber(month?.year),
                    month: asNullableNumber(month?.month),
                    searchVolume: asNullableNumber(month?.search_volume),
                }))
                .filter((month) => month.year && month.month)
                .slice(0, 12)
            : [],
    };
}

async function fetchKeywordAdsSnapshot(seed, context = {}, options = {}) {
    const auth = getAuthConfig();
    if (!auth.login || !auth.password) {
        throw new Error('DataForSEO credentials are not configured');
    }

    const locationCode = options.locationCode ?? getLocationCode();
    const languageCode = options.languageCode ?? getLanguageCode();
    const searchPartners = options.searchPartners ?? getSearchPartners();
    const taskKeywords = buildAdsSeedKeywords({
        seed,
        suggestions: context.suggestions,
        serpData: context.serpData,
        keywordUniverse: context.keywordUniverse,
    });

    if (!taskKeywords.length) {
        return {
            taskKeywords: [],
            locationCode,
            languageCode,
            searchPartners,
            fetchedAt: new Date().toISOString(),
            cost: 0,
            results: [],
        };
    }

    const response = await axios({
        method: 'post',
        url: DATAFORSEO_ENDPOINT,
        auth: {
            username: auth.login,
            password: auth.password,
        },
        data: [
            {
                location_code: locationCode,
                language_code: languageCode,
                search_partners: searchPartners,
                sort_by: 'search_volume',
                keywords: taskKeywords,
                tag: typeof options.tag === 'string' ? options.tag.slice(0, 255) : undefined,
            },
        ],
        headers: {
            'content-type': 'application/json',
        },
        timeout: 30000,
    });

    if (Number(response?.data?.status_code) !== 20000) {
        throw new Error(response?.data?.status_message || 'DataForSEO request failed');
    }

    const task = Array.isArray(response?.data?.tasks) ? response.data.tasks[0] : null;
    if (!task || Number(task.status_code) !== 20000) {
        throw new Error(task?.status_message || 'DataForSEO task failed');
    }

    const rawResults = Array.isArray(task.result) ? task.result : [];
    const results = rawResults
        .map((entry) => mapAdsResult(entry))
        .filter(Boolean)
        .slice(0, MAX_STORED_RESULTS);

    return {
        taskId: task.id || null,
        taskKeywords,
        locationCode,
        languageCode,
        searchPartners,
        fetchedAt: new Date().toISOString(),
        cost: asNullableNumber(task.cost) ?? asNullableNumber(response?.data?.cost) ?? 0,
        results,
    };
}

module.exports = {
    buildAdsSeedKeywords,
    buildAdsCacheKey,
    getCachedKeywordAdsSnapshot,
    saveKeywordAdsSnapshot,
    fetchKeywordAdsSnapshot,
    getLocationCode,
    getLanguageCode,
    getSearchPartners,
    __internal: {
        normalizeKeywordText,
        collectUniqueKeywords,
        isQuestionLikeKeyword,
        mapAdsResult,
    },
};
