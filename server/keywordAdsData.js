const crypto = require('node:crypto');

const { KeywordAdsCache } = require('./models');

const DEFAULT_KEYWORD_ADS_PROVIDER = 'google_ads_api';
const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = 'en';
const DEFAULT_CACHE_TTL_DAYS = 30;
const MAX_TASK_KEYWORDS = 20;

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
    const raw = String(process.env.GOOGLE_ADS_LOCATION_IDS || DEFAULT_LOCATION_CODE);
    const values = raw
        .split(',')
        .map((entry) => String(entry || '').replace(/\D/g, ''))
        .filter(Boolean)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));

    return values[0] || DEFAULT_LOCATION_CODE;
}

function getLanguageCode() {
    const value = String(process.env.GOOGLE_ADS_LANGUAGE_CODE || DEFAULT_LANGUAGE_CODE).trim().toLowerCase();
    return value || DEFAULT_LANGUAGE_CODE;
}

function getSearchPartners() {
    return parseBoolean(process.env.GOOGLE_ADS_SEARCH_PARTNERS, false);
}

function getCacheTtlDays() {
    return Math.max(1, parseInteger(process.env.GOOGLE_ADS_CACHE_TTL_DAYS, DEFAULT_CACHE_TTL_DAYS));
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
        provider: options.provider ?? DEFAULT_KEYWORD_ADS_PROVIDER,
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
            provider: options.provider ?? DEFAULT_KEYWORD_ADS_PROVIDER,
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

module.exports = {
    DEFAULT_KEYWORD_ADS_PROVIDER,
    buildAdsSeedKeywords,
    buildAdsCacheKey,
    getCachedKeywordAdsSnapshot,
    getKeywordAdsCacheTtlDays: getCacheTtlDays,
    getKeywordAdsLanguageCode: getLanguageCode,
    getKeywordAdsLocationCode: getLocationCode,
    getKeywordAdsSearchPartners: getSearchPartners,
    saveKeywordAdsSnapshot,
    __internal: {
        collectUniqueKeywords,
        isQuestionLikeKeyword,
        normalizeKeywordText,
        parseBoolean,
        parseInteger,
    },
};
