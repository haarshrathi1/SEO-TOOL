const axios = require('axios');

// Using direct HTTP call as it's simpler for PSI than setting up the full GoogleAuth client for a public API
// (unless using private API key, which we get from Auth client if needed? 
// actually n8n used an API Key "AIza...").
// We should probably rely on the User's OAuth token OR just calling it without auth (lower limit) 
// OR user needs to provide API Key in .env. 
// For now, we will try without key (lower quota) or use the Access Token if possible.
// Actually, PSI API key is public usually. 
// We will use the Google Auth Access Token which works for Quota.
const { getAuthClient } = require('./auth');

const PSI_API_BASE = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const DEFAULT_TIMEOUT_MS = 60000;
const DEFAULT_MAX_ATTEMPTS = 3;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPsiEndpoint(url, strategy, categories) {
    const params = new URLSearchParams();
    params.set('url', url);
    params.set('strategy', strategy);
    (categories || []).forEach((category) => {
        params.append('category', category);
    });
    return `${PSI_API_BASE}?${params.toString()}`;
}

function getErrorStatus(error) {
    return Number(error?.response?.status || error?.status || error?.code || 0);
}

function getErrorMessage(error) {
    if (!error) {
        return 'Unknown PSI error';
    }

    if (typeof error?.response?.data?.error?.message === 'string' && error.response.data.error.message.trim()) {
        return error.response.data.error.message.trim();
    }

    if (typeof error.message === 'string' && error.message.trim()) {
        return error.message.trim();
    }

    return 'Unknown PSI error';
}

function isRetriablePsiError(error) {
    const status = getErrorStatus(error);
    if (RETRYABLE_STATUS_CODES.has(status)) {
        return true;
    }

    const message = getErrorMessage(error).toLowerCase();
    return [
        'timeout',
        'timed out',
        'econnreset',
        'socket hang up',
        'temporarily unavailable',
        'backend error',
        'internal error',
    ].some((token) => message.includes(token));
}

async function runPsiRequest(url, strategy, categories, token, requestOptions = {}) {
    const endpoint = buildPsiEndpoint(url, strategy, categories);
    const headers = token ? { Authorization: `Bearer ${token}` } : {};

    const response = await axios.get(endpoint, {
        headers,
        timeout: Number(requestOptions.timeoutMs || DEFAULT_TIMEOUT_MS),
    });

    return response.data;
}

async function runPsiWithRetries(url, strategy, categories, token, requestOptions = {}) {
    const maxAttempts = Math.max(1, Number(requestOptions.maxAttempts || DEFAULT_MAX_ATTEMPTS));

    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            return await runPsiRequest(url, strategy, categories, token, requestOptions);
        } catch (error) {
            lastError = error;
            if (!isRetriablePsiError(error) || attempt >= maxAttempts) {
                break;
            }

            const backoffMs = 800 * attempt;
            await sleep(backoffMs);
        }
    }

    throw lastError || new Error('PSI request failed');
}

async function fetchPsiForStrategy(url, strategy, token, requestOptions = {}) {
    const primaryCategories = ['PERFORMANCE', 'SEO'];
    const fallbackCategories = ['PERFORMANCE'];

    try {
        return await runPsiWithRetries(url, strategy, primaryCategories, token, requestOptions);
    } catch (primaryError) {
        // Some PSI backends intermittently 500 on multi-category requests; degrade to PERFORMANCE-only.
        try {
            const fallbackData = await runPsiWithRetries(url, strategy, fallbackCategories, token, requestOptions);
            return {
                ...fallbackData,
                _warning: `PSI ${strategy} fell back to PERFORMANCE-only metrics after: ${getErrorMessage(primaryError)}`,
            };
        } catch (fallbackError) {
            throw fallbackError;
        }
    }
}

const getPSI = async (url) => {
    const auth = getAuthClient();
    // we can get the token and pass it as key or bearer
    // but PSI v5 supports access_token query param.

    let token = '';
    if (auth) {
        try {
            const credentials = await auth.getAccessToken();
            token = credentials?.token || '';
        } catch (error) {
            console.warn('PSI auth token fetch failed, retrying without token:', getErrorMessage(error));
        }
    }

    const strategies = ['desktop', 'mobile'];
    const results = {};

    for (const strategy of strategies) {
        try {
            results[strategy] = await fetchPsiForStrategy(url, strategy, token);
        } catch (e) {
            const message = getErrorMessage(e);
            console.warn(`PSI Error for ${strategy}: ${message}`);
            results[strategy] = {
                error: message,
                status: getErrorStatus(e),
            };
        }
    }

    return results;
};

module.exports = {
    getPSI,
    __internal: {
        buildPsiEndpoint,
        getErrorStatus,
        getErrorMessage,
        isRetriablePsiError,
    },
};
