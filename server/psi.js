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
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_MAX_ATTEMPTS = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildPsiEndpoint(url, strategy, categories, apiKey = '') {
    const params = new URLSearchParams();
    params.set('url', url);
    params.set('strategy', strategy);
    if (apiKey) {
        params.set('key', apiKey);
    }
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
    const endpoint = buildPsiEndpoint(url, strategy, categories, requestOptions.apiKey);
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

const getPSI = async (url, options = {}) => {
    const auth = options.authClient || getAuthClient();
    const apiKey = String(process.env.PAGESPEED_API_KEY || '').trim();
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

    const strategies = ['mobile', 'desktop'];

    // Run both strategies in parallel — they are independent network calls and
    // sequential execution was the dominant cost when PSI ran inline in the crawl.
    const settled = await Promise.all(strategies.map(async (strategy) => {
        try {
            return [strategy, await fetchPsiForStrategy(url, strategy, token, { apiKey })];
        } catch (e) {
            const message = getErrorMessage(e);
            console.warn(`PSI Error for ${strategy}: ${message}`);
            return [strategy, { error: message, status: getErrorStatus(e) }];
        }
    }));

    return Object.fromEntries(settled);
};

// Collapse a raw PSI response (mobile/desktop) into the compact shape the UI consumes.
function formatPsiSummary(rawPsi = {}) {
    const pick = (strategy) => {
        const audits = rawPsi?.[strategy]?.lighthouseResult?.audits || {};
        const rawScore = rawPsi?.[strategy]?.lighthouseResult?.categories?.performance?.score;
        return {
            score: Math.round((Number(rawScore) || 0) * 100),
            lcp: audits['largest-contentful-paint']?.displayValue,
            cls: audits['cumulative-layout-shift']?.displayValue,
            inp: audits['interaction-to-next-paint']?.displayValue,
        };
    };

    const mobile = pick('mobile');
    const desktop = pick('desktop');
    return {
        psi_score: mobile.score || desktop.score || 0,
        psi_data: { mobile, desktop },
    };
}

module.exports = {
    getPSI,
    formatPsiSummary,
    __internal: {
        buildPsiEndpoint,
        getErrorStatus,
        getErrorMessage,
        isRetriablePsiError,
    },
};
