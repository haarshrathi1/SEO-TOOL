const axios = require('axios');
const { OAuth2Client } = require('google-auth-library');

const {
    GOOGLE_ADS_OAUTH_SCOPE,
    getServiceAccountAuth,
    getStoredGoogleAdsOauthTokens,
    getStoredOauthTokens,
    hasOauthScope,
    googleAdsOauth2Client,
    oauth2Client,
} = require('./auth');
const {
    buildAdsSeedKeywords,
    getKeywordAdsCacheTtlDays,
    getKeywordAdsLanguageCode,
    getKeywordAdsSearchPartners,
} = require('./keywordAdsData');

const GOOGLE_ADS_PROVIDER = 'google_ads_api';
const GOOGLE_ADS_PROVIDER_LABEL = 'Google Ads API';
const GOOGLE_ADS_API_BASE = 'https://googleads.googleapis.com';
const DEFAULT_API_VERSION = 'v23';
const DEFAULT_LOCATION_ID = 2840;
const DEFAULT_LANGUAGE_ID = 1000;
const DEFAULT_LANGUAGE_CODE = 'en';
const DEFAULT_CACHE_TTL_DAYS = 30;
const DEFAULT_PAGE_SIZE = 200;
const MAX_STORED_RESULTS = 500;

const MONTH_NUMBER_BY_NAME = {
    JANUARY: 1,
    FEBRUARY: 2,
    MARCH: 3,
    APRIL: 4,
    MAY: 5,
    JUNE: 6,
    JULY: 7,
    AUGUST: 8,
    SEPTEMBER: 9,
    OCTOBER: 10,
    NOVEMBER: 11,
    DECEMBER: 12,
};

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

function asNullableNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

function microsToCurrency(value) {
    const parsed = asNullableNumber(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }

    return Number((parsed / 1_000_000).toFixed(2));
}

function normalizeCustomerId(value) {
    const normalized = String(value || '').replace(/\D/g, '');
    return normalized || '';
}

function normalizeKeywordText(value) {
    return String(value || '')
        .replace(/[^0-9a-zA-Z\s&+/\-.'()]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase()
        .slice(0, 80);
}

function getDeveloperToken() {
    return String(
        process.env.GOOGLE_ADS_DEVELOPER_TOKEN
        || process.env.GOOGLE_ADS_API_DEVELOPER_TOKEN
        || ''
    ).trim();
}

function getCustomerId() {
    return normalizeCustomerId(process.env.GOOGLE_ADS_CUSTOMER_ID);
}

function getLoginCustomerId() {
    return normalizeCustomerId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
}

function getExplicitRefreshToken() {
    return String(process.env.GOOGLE_ADS_REFRESH_TOKEN || '').trim();
}

function getApiVersion() {
    const version = String(process.env.GOOGLE_ADS_API_VERSION || DEFAULT_API_VERSION).trim().toLowerCase();
    return /^v\d+$/.test(version) ? version : DEFAULT_API_VERSION;
}

function getLocationIds() {
    const raw = String(process.env.GOOGLE_ADS_LOCATION_IDS || DEFAULT_LOCATION_ID);
    const values = raw
        .split(',')
        .map((entry) => normalizeCustomerId(entry))
        .filter(Boolean)
        .map((entry) => Number(entry))
        .filter((entry) => Number.isFinite(entry));

    return values.length > 0 ? values : [DEFAULT_LOCATION_ID];
}

function getLocationCode() {
    return getLocationIds()[0] || DEFAULT_LOCATION_ID;
}

function getLanguageId() {
    return parseInteger(process.env.GOOGLE_ADS_LANGUAGE_ID, DEFAULT_LANGUAGE_ID);
}

function getLanguageCode() {
    return getKeywordAdsLanguageCode() || DEFAULT_LANGUAGE_CODE;
}

function getSearchPartners() {
    return getKeywordAdsSearchPartners();
}

function getCacheTtlDays() {
    return getKeywordAdsCacheTtlDays() || DEFAULT_CACHE_TTL_DAYS;
}

function getPageSize() {
    return Math.max(1, Math.min(MAX_STORED_RESULTS, parseInteger(process.env.GOOGLE_ADS_PAGE_SIZE, DEFAULT_PAGE_SIZE)));
}

function buildGeoTargetResourceNames(locationIds = getLocationIds()) {
    return locationIds
        .map((locationId) => parseInteger(locationId, NaN))
        .filter((locationId) => Number.isFinite(locationId))
        .map((locationId) => `geoTargetConstants/${locationId}`);
}

function buildLanguageResourceName(languageId = getLanguageId()) {
    return `languageConstants/${languageId}`;
}

function getAuthSourceState() {
    const explicitRefreshToken = getExplicitRefreshToken();
    if (explicitRefreshToken) {
        const clientId = String(process.env.CLIENT_ID || '').trim();
        const clientSecret = String(process.env.CLIENT_SECRET || '').trim();

        if (!clientId || !clientSecret) {
            return {
                configured: false,
                source: 'env_refresh_token',
                reason: 'missing_oauth_client',
            };
        }

        return {
            configured: true,
            source: 'env_refresh_token',
            reason: 'ok',
        };
    }

    const storedGoogleAdsTokens = getStoredGoogleAdsOauthTokens();
    if (storedGoogleAdsTokens?.refresh_token || storedGoogleAdsTokens?.access_token) {
        if (!hasOauthScope(GOOGLE_ADS_OAUTH_SCOPE, storedGoogleAdsTokens)) {
            return {
                configured: false,
                source: 'stored_google_ads_oauth',
                reason: 'missing_oauth_scope',
            };
        }

        return {
            configured: true,
            source: 'stored_google_ads_oauth',
            reason: 'ok',
        };
    }

    const storedTokens = getStoredOauthTokens();
    if (storedTokens?.refresh_token || storedTokens?.access_token) {
        if (!hasOauthScope(GOOGLE_ADS_OAUTH_SCOPE, storedTokens)) {
            return {
                configured: false,
                source: 'stored_oauth',
                reason: 'missing_oauth_scope',
            };
        }

        return {
            configured: true,
            source: 'stored_oauth',
            reason: 'ok',
        };
    }

    const serviceAccount = getServiceAccountAuth();
    if (serviceAccount) {
        return {
            configured: true,
            source: 'service_account',
            reason: 'ok',
        };
    }

    return {
        configured: false,
        source: 'missing',
        reason: 'missing_oauth_credentials',
    };
}

function getGoogleAdsProviderConfig() {
    const developerToken = getDeveloperToken();
    const customerId = getCustomerId();
    const authSource = getAuthSourceState();

    let reason = 'ok';
    if (!developerToken) {
        reason = 'missing_developer_token';
    } else if (!customerId) {
        reason = 'missing_customer_id';
    } else if (!authSource.configured) {
        reason = authSource.reason;
    }

    return {
        provider: GOOGLE_ADS_PROVIDER,
        providerLabel: GOOGLE_ADS_PROVIDER_LABEL,
        configured: reason === 'ok',
        reason,
        authSource: authSource.source,
        developerTokenConfigured: Boolean(developerToken),
        customerId,
        loginCustomerId: getLoginCustomerId(),
        apiVersion: getApiVersion(),
        locationIds: getLocationIds(),
        locationCode: getLocationCode(),
        languageId: getLanguageId(),
        languageCode: getLanguageCode(),
        searchPartners: getSearchPartners(),
        cacheTtlDays: getCacheTtlDays(),
        pageSize: getPageSize(),
    };
}

function normalizeAccessToken(value) {
    if (!value) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (typeof value === 'object' && typeof value.token === 'string') {
        return value.token;
    }

    return '';
}

async function getGoogleAdsAccessToken() {
    const authSource = getAuthSourceState();
    if (!authSource.configured) {
        throw new Error(`Google Ads authentication is not ready (${authSource.reason})`);
    }

    if (authSource.source === 'env_refresh_token') {
        const client = new OAuth2Client(
            String(process.env.CLIENT_ID || '').trim(),
            String(process.env.CLIENT_SECRET || '').trim()
        );
        client.setCredentials({ refresh_token: getExplicitRefreshToken() });
        const token = normalizeAccessToken(await client.getAccessToken());
        if (!token) {
            throw new Error('Failed to mint a Google Ads access token from GOOGLE_ADS_REFRESH_TOKEN');
        }
        return token;
    }

    if (authSource.source === 'stored_google_ads_oauth') {
        const token = normalizeAccessToken(await googleAdsOauth2Client.getAccessToken());
        if (!token) {
            throw new Error('Failed to mint a Google Ads access token from stored Google Ads OAuth credentials');
        }
        return token;
    }

    if (authSource.source === 'stored_oauth') {
        const token = normalizeAccessToken(await oauth2Client.getAccessToken());
        if (!token) {
            throw new Error('Failed to mint a Google Ads access token from stored OAuth credentials');
        }
        return token;
    }

    if (authSource.source === 'service_account') {
        const serviceAccount = getServiceAccountAuth();
        const token = normalizeAccessToken(await serviceAccount.getAccessToken());
        if (!token) {
            throw new Error('Failed to mint a Google Ads access token from the service account');
        }
        return token;
    }

    throw new Error('Google Ads authentication is unavailable');
}

function buildHeaders(config, accessToken) {
    const headers = {
        Authorization: `Bearer ${accessToken}`,
        'developer-token': getDeveloperToken(),
        'content-type': 'application/json',
    };

    if (config.loginCustomerId) {
        headers['login-customer-id'] = config.loginCustomerId;
    }

    return headers;
}

function buildRequestBody(taskKeywords, config, pageToken = null) {
    const body = {
        language: buildLanguageResourceName(config.languageId),
        geoTargetConstants: buildGeoTargetResourceNames(config.locationIds),
        keywordPlanNetwork: config.searchPartners ? 'GOOGLE_SEARCH_AND_PARTNERS' : 'GOOGLE_SEARCH',
        pageSize: config.pageSize,
        keywordSeed: {
            keywords: taskKeywords,
        },
    };

    if (pageToken) {
        body.pageToken = pageToken;
    }

    return body;
}

function mapMonthlySearchVolume(entry) {
    const year = asNullableNumber(entry?.year);
    const monthName = String(entry?.month || '').trim().toUpperCase();
    const month = MONTH_NUMBER_BY_NAME[monthName] || null;

    if (!year || !month) {
        return null;
    }

    return {
        year,
        month,
        searchVolume: asNullableNumber(entry?.monthlySearches),
    };
}

function mapGoogleAdsResult(entry) {
    const keyword = normalizeKeywordText(entry?.text);
    if (!keyword) {
        return null;
    }

    const metrics = entry?.keywordIdeaMetrics || {};
    const competition = String(metrics.competition || '').trim().toUpperCase();
    const monthlySearches = Array.isArray(metrics.monthlySearchVolumes)
        ? metrics.monthlySearchVolumes
            .map((volume) => mapMonthlySearchVolume(volume))
            .filter(Boolean)
            .slice(0, 12)
        : [];

    return {
        keyword,
        competition: competition && competition !== 'UNSPECIFIED' && competition !== 'UNKNOWN' ? competition : null,
        competitionIndex: asNullableNumber(metrics.competitionIndex),
        searchVolume: asNullableNumber(metrics.avgMonthlySearches),
        cpc: microsToCurrency(metrics.averageCpcMicros),
        lowTopOfPageBid: microsToCurrency(metrics.lowTopOfPageBidMicros),
        highTopOfPageBid: microsToCurrency(metrics.highTopOfPageBidMicros),
        monthlySearches,
    };
}

function extractGoogleAdsErrorMessage(error) {
    const oauthDescription = error?.response?.data?.error_description;
    if (oauthDescription) {
        const oauthCode = error?.response?.data?.error;
        return oauthCode ? `${oauthCode}: ${oauthDescription}` : oauthDescription;
    }

    const oauthCode = error?.response?.data?.error;
    if (typeof oauthCode === 'string' && oauthCode) {
        return oauthCode;
    }

    const googleError = typeof error?.response?.data?.error === 'object' && error?.response?.data?.error
        ? error.response.data.error
        : null;
    const googleMessage = googleError?.message;
    if (googleMessage) {
        return googleMessage;
    }

    const errorDetails = googleError?.details;
    if (Array.isArray(errorDetails) && errorDetails.length > 0) {
        const firstMessage = errorDetails
            .map((detail) => detail?.message || detail?.description)
            .find(Boolean);
        if (firstMessage) {
            return firstMessage;
        }
    }

    if (googleError) {
        try {
            return JSON.stringify(googleError);
        } catch {
            return String(googleError);
        }
    }

    if (error?.response?.status) {
        return `Google Ads API request failed with status ${error.response.status}`;
    }

    return error?.message || 'Google Ads API request failed';
}

async function fetchGoogleAdsSnapshot(seed, context = {}, options = {}) {
    const config = {
        ...getGoogleAdsProviderConfig(),
        locationIds: Array.isArray(options.locationIds) && options.locationIds.length > 0
            ? options.locationIds.map((entry) => parseInteger(entry, NaN)).filter((entry) => Number.isFinite(entry))
            : getLocationIds(),
        locationCode: options.locationCode ?? getLocationCode(),
        languageId: options.languageId ?? getLanguageId(),
        languageCode: options.languageCode ?? getLanguageCode(),
        searchPartners: options.searchPartners ?? getSearchPartners(),
        pageSize: options.pageSize ?? getPageSize(),
    };

    if (!config.configured) {
        throw new Error(`Google Ads API is not configured (${config.reason})`);
    }

    const taskKeywords = buildAdsSeedKeywords({
        seed,
        suggestions: context.suggestions,
        serpData: context.serpData,
        keywordUniverse: context.keywordUniverse,
    });

    if (!taskKeywords.length) {
        return {
            provider: GOOGLE_ADS_PROVIDER,
            providerLabel: GOOGLE_ADS_PROVIDER_LABEL,
            taskKeywords: [],
            locationCode: config.locationCode,
            languageCode: config.languageCode,
            searchPartners: config.searchPartners,
            fetchedAt: new Date().toISOString(),
            cost: 0,
            results: [],
        };
    }

    const accessToken = await getGoogleAdsAccessToken();
    const url = `${GOOGLE_ADS_API_BASE}/${config.apiVersion}/customers/${config.customerId}:generateKeywordIdeas`;
    const results = [];
    let pageToken = null;

    try {
        do {
            const response = await axios({
                method: 'post',
                url,
                headers: buildHeaders(config, accessToken),
                data: buildRequestBody(taskKeywords, config, pageToken),
                timeout: 30000,
            });

            const pageResults = Array.isArray(response?.data?.results) ? response.data.results : [];
            results.push(
                ...pageResults
                    .map((entry) => mapGoogleAdsResult(entry))
                    .filter(Boolean)
            );

            pageToken = typeof response?.data?.nextPageToken === 'string' && response.data.nextPageToken.trim()
                ? response.data.nextPageToken.trim()
                : null;
        } while (pageToken && results.length < MAX_STORED_RESULTS);
    } catch (error) {
        throw new Error(extractGoogleAdsErrorMessage(error));
    }

    return {
        provider: GOOGLE_ADS_PROVIDER,
        providerLabel: GOOGLE_ADS_PROVIDER_LABEL,
        taskKeywords,
        locationCode: config.locationCode,
        languageCode: config.languageCode,
        searchPartners: config.searchPartners,
        fetchedAt: new Date().toISOString(),
        cost: 0,
        results: results.slice(0, MAX_STORED_RESULTS),
    };
}

async function probeGoogleAdsAccess() {
    const config = getGoogleAdsProviderConfig();
    if (!config.configured) {
        return {
            ok: false,
            provider: GOOGLE_ADS_PROVIDER,
            providerLabel: GOOGLE_ADS_PROVIDER_LABEL,
            reason: config.reason,
            message: `Google Ads API is not configured (${config.reason})`,
        };
    }

    try {
        const accessToken = await getGoogleAdsAccessToken();
        const response = await axios({
            method: 'get',
            url: `${GOOGLE_ADS_API_BASE}/${config.apiVersion}/customers:listAccessibleCustomers`,
            headers: buildHeaders(config, accessToken),
            timeout: 30000,
        });

        return {
            ok: true,
            provider: GOOGLE_ADS_PROVIDER,
            providerLabel: GOOGLE_ADS_PROVIDER_LABEL,
            accessibleCustomers: Array.isArray(response?.data?.resourceNames) ? response.data.resourceNames : [],
        };
    } catch (error) {
        return {
            ok: false,
            provider: GOOGLE_ADS_PROVIDER,
            providerLabel: GOOGLE_ADS_PROVIDER_LABEL,
            reason: 'request_failed',
            message: extractGoogleAdsErrorMessage(error),
            status: error?.response?.status ?? null,
        };
    }
}

module.exports = {
    GOOGLE_ADS_PROVIDER,
    GOOGLE_ADS_PROVIDER_LABEL,
    fetchGoogleAdsSnapshot,
    getCacheTtlDays,
    getGoogleAdsProviderConfig,
    getLanguageCode,
    getLocationCode,
    getSearchPartners,
    probeGoogleAdsAccess,
    __internal: {
        buildGeoTargetResourceNames,
        buildLanguageResourceName,
        buildRequestBody,
        extractGoogleAdsErrorMessage,
        getAuthSourceState,
        mapGoogleAdsResult,
        mapMonthlySearchVolume,
        microsToCurrency,
        normalizeCustomerId,
        normalizeKeywordText,
    },
};
