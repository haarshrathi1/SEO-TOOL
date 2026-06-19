require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

const BACKEND_VERTEX = 'vertex';
const BACKEND_GEMINI = 'gemini';
const MAX_ATTEMPTS = Math.max(1, Number(process.env.GENAI_RETRY_ATTEMPTS || 4));
const BASE_RETRY_DELAY_MS = Math.max(250, Number(process.env.GENAI_RETRY_BASE_DELAY_MS || 1200));

const clients = {};

function parseModelList(value) {
    if (!value) {
        return [];
    }

    if (Array.isArray(value)) {
        return value
            .flatMap((item) => parseModelList(item))
            .filter(Boolean);
    }

    return String(value)
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
}

function uniqueValues(values) {
    return [...new Set((values || []).filter(Boolean))];
}

const DEFAULT_PAGE_MODEL = parseModelList(
    process.env.GENAI_PAGE_MODEL || process.env.GEMINI_PAGE_MODEL || 'gemini-3.5-flash'
)[0] || 'gemini-3.5-flash';
const DEFAULT_PAGE_MODEL_FALLBACKS = uniqueValues(parseModelList(
    process.env.GENAI_PAGE_MODEL_FALLBACKS || process.env.GEMINI_PAGE_MODEL_FALLBACKS || 'gemini-2.5-flash'
));
const DEFAULT_KEYWORD_MODELS = uniqueValues([
    ...parseModelList(process.env.GENAI_KEYWORD_MODEL || process.env.GEMINI_KEYWORD_MODEL || 'gemini-3.5-flash'),
    ...parseModelList(process.env.GENAI_KEYWORD_MODEL_FALLBACKS || process.env.GEMINI_KEYWORD_MODEL_FALLBACKS || 'gemini-2.5-flash'),
]);
const DEFAULT_KEYWORD_MODEL = DEFAULT_KEYWORD_MODELS[0] || 'gemini-3.5-flash';
const DEFAULT_KEYWORD_MODEL_FALLBACKS = DEFAULT_KEYWORD_MODELS.slice(1);
const DEFAULT_GROUNDED_SEARCH_MODEL = parseModelList(
    process.env.GENAI_GROUNDED_SEARCH_MODEL || process.env.GEMINI_GROUNDED_SEARCH_MODEL || 'gemini-3.5-flash'
)[0] || 'gemini-3.5-flash';

function getVertexApiKey() {
    return process.env.VERTEX_AI_API_KEY || process.env.GOOGLE_VERTEX_API_KEY || '';
}

function getGeminiApiKey() {
    return process.env.GEMINI_API_KEY || process.env.GEMINI_KEYWORD_API_KEY || process.env.GOOGLE_API_KEY || '';
}

function hasVertexBackend() {
    return Boolean(getVertexApiKey());
}

function hasGeminiBackend() {
    return Boolean(getGeminiApiKey());
}

// Vertex express (AQ.* enterprise key) is primary when configured; the
// Gemini Developer API key is the fallback backend.
function getPrimaryBackend() {
    return hasVertexBackend() ? BACKEND_VERTEX : BACKEND_GEMINI;
}

function getProviderRuntime() {
    return {
        primaryBackend: getPrimaryBackend(),
        availableBackends: [
            hasVertexBackend() ? BACKEND_VERTEX : null,
            hasGeminiBackend() ? BACKEND_GEMINI : null,
        ].filter(Boolean),
        allowGeminiFallback: hasVertexBackend() && hasGeminiBackend(),
        retryAttempts: MAX_ATTEMPTS,
        pageModel: DEFAULT_PAGE_MODEL,
        pageModelFallbacks: DEFAULT_PAGE_MODEL_FALLBACKS,
        keywordModel: DEFAULT_KEYWORD_MODEL,
        keywordModelFallbacks: DEFAULT_KEYWORD_MODEL_FALLBACKS,
        groundedSearchModel: DEFAULT_GROUNDED_SEARCH_MODEL,
    };
}

function formatBackendLabel(backend) {
    return backend === BACKEND_VERTEX ? 'Vertex AI' : 'Gemini API';
}

function getClient(backend) {
    if (clients[backend]) {
        return clients[backend];
    }

    if (backend === BACKEND_VERTEX) {
        clients[backend] = new GoogleGenAI({
            vertexai: true,
            apiKey: getVertexApiKey(),
            apiVersion: process.env.GENAI_VERTEX_API_VERSION || 'v1',
        });
        return clients[backend];
    }

    const geminiOptions = {
        apiKey: getGeminiApiKey(),
    };
    if (process.env.GENAI_API_VERSION) {
        geminiOptions.apiVersion = process.env.GENAI_API_VERSION;
    }
    clients[backend] = new GoogleGenAI(geminiOptions);
    return clients[backend];
}

function buildBackendOrder(allowFallback = true) {
    const order = [];
    if (hasVertexBackend()) {
        order.push(BACKEND_VERTEX);
    }
    if (hasGeminiBackend() && (allowFallback || order.length === 0)) {
        order.push(BACKEND_GEMINI);
    }
    return order;
}

// The Vertex express v1 API rejects responseMimeType and lags on thinking
// options, so send it the proven-compatible config; parseJsonResponse
// extracts JSON from raw text. The Gemini API gets the full config.
function sanitizeConfigForBackend(backend, config = {}) {
    if (!config || typeof config !== 'object') {
        return {};
    }

    if (backend !== BACKEND_VERTEX) {
        return { ...config };
    }

    const nextConfig = { ...config };
    delete nextConfig.responseMimeType;
    delete nextConfig.thinkingConfig;
    return nextConfig;
}

function extractErrorMessage(error) {
    if (!error) {
        return 'Unknown provider error';
    }

    if (typeof error.message === 'string' && error.message.trim()) {
        return error.message.trim();
    }

    if (typeof error.statusText === 'string' && error.statusText.trim()) {
        return error.statusText.trim();
    }

    return 'Unknown provider error';
}

function getErrorStatus(error) {
    return Number(
        error?.status
        || error?.code
        || error?.response?.status
        || error?.cause?.status
        || 0
    );
}

function isRetriableError(error) {
    const status = getErrorStatus(error);
    if ([408, 409, 429, 500, 502, 503, 504].includes(status)) {
        return true;
    }

    const message = extractErrorMessage(error).toLowerCase();
    return [
        'resource exhausted',
        'rate limit',
        'quota',
        'temporarily unavailable',
        'deadline exceeded',
        'timed out',
        'timeout',
        'connection reset',
        'econnreset',
        'socket hang up',
        'unavailable',
        'backend error',
        'internal error',
        'etimedout',
        'eai_again',
    ].some((token) => message.includes(token));
}

// Model-not-found errors should fall through to the next model in the list
// instead of aborting (e.g. a preview model id was retired).
function isUnknownModelError(error) {
    const status = getErrorStatus(error);
    const message = extractErrorMessage(error).toLowerCase();
    return status === 404 || message.includes('not found') || message.includes('is not supported');
}

// A 429 against a *daily* quota will not clear within any sane retry window,
// so skip retries and let the model/backend fallback chain take over.
function isDailyQuotaError(error) {
    if (getErrorStatus(error) !== 429) {
        return false;
    }
    return /per\s*day|perday|daily/i.test(extractErrorMessage(error));
}

// Gemini 429 responses embed RetryInfo, e.g. '"retryDelay":"22s"'. Waiting
// less than that just burns attempts inside the same rate-limit window.
function getSuggestedRetryDelayMs(error) {
    const message = extractErrorMessage(error);
    const match = message.match(/retryDelay"?\s*[:=]\s*"?(\d+(?:\.\d+)?)\s*s/i)
        || message.match(/retry (?:in|after)\s+(\d+(?:\.\d+)?)\s*s/i);
    return match ? Math.ceil(Number(match[1]) * 1000) : 0;
}

const RATE_LIMIT_MIN_DELAY_MS = 10000;
const MAX_RETRY_DELAY_MS = 120000;

function getRetryDelayMs(attempt, error = null) {
    const jitter = Math.floor(Math.random() * 250);
    const backoff = BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1)) + jitter;
    const suggested = getSuggestedRetryDelayMs(error);
    const floor = getErrorStatus(error) === 429 ? Math.max(backoff, RATE_LIMIT_MIN_DELAY_MS) : backoff;
    return Math.min(Math.max(floor, suggested), MAX_RETRY_DELAY_MS);
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

function getResponseText(response) {
    if (!response) {
        return '';
    }

    if (typeof response.text === 'function') {
        return response.text();
    }

    if (typeof response.text === 'string') {
        return response.text;
    }

    return '';
}

function buildModelOrder(options = {}) {
    const explicitModels = uniqueValues([
        ...parseModelList(options.model),
        ...parseModelList(options.modelFallbacks),
    ]);

    if (explicitModels.length > 0) {
        return explicitModels;
    }

    if (options.modelType === 'page') {
        return uniqueValues([DEFAULT_PAGE_MODEL, ...DEFAULT_PAGE_MODEL_FALLBACKS]);
    }

    if (options.useGoogleSearchGrounding) {
        return uniqueValues([
            DEFAULT_GROUNDED_SEARCH_MODEL,
            DEFAULT_KEYWORD_MODEL,
            ...DEFAULT_KEYWORD_MODEL_FALLBACKS,
        ]);
    }

    return uniqueValues([DEFAULT_KEYWORD_MODEL, ...DEFAULT_KEYWORD_MODEL_FALLBACKS]);
}

function emitEvent(onEvent, event) {
    if (typeof onEvent !== 'function') {
        return;
    }

    try {
        const maybePromise = onEvent(event);
        if (maybePromise && typeof maybePromise.catch === 'function') {
            maybePromise.catch((eventError) => {
                console.warn('[GenAI] Async event handler failed:', eventError?.message || eventError);
            });
        }
    } catch (eventError) {
        console.warn('[GenAI] Failed to emit event:', eventError?.message || eventError);
    }
}

function sanitizeJsonText(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
        return '';
    }

    return trimmed
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function extractJsonCandidate(text) {
    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
        return text.slice(objectStart, objectEnd + 1);
    }

    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart !== -1 && arrayEnd !== -1 && arrayEnd > arrayStart) {
        return text.slice(arrayStart, arrayEnd + 1);
    }

    return text;
}

function parseJsonResponse(text) {
    const sanitized = sanitizeJsonText(text);
    const candidates = [sanitized, extractJsonCandidate(sanitized)]
        .filter(Boolean)
        .filter((candidate, index, all) => all.indexOf(candidate) === index);

    for (const candidate of candidates) {
        try {
            return JSON.parse(candidate);
        } catch {
            continue;
        }
    }

    throw new Error(`Model returned invalid JSON: ${sanitized.slice(0, 200) || 'empty response'}`);
}

async function requestContentFromBackend(backend, options) {
    const {
        taskName = 'content generation',
        model,
        contents,
        config,
        onEvent,
    } = options;

    const client = getClient(backend);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
        emitEvent(onEvent, {
            type: 'attempt',
            backend,
            provider: formatBackendLabel(backend),
            taskName,
            model,
            attempt,
            maxAttempts: MAX_ATTEMPTS,
        });

        try {
            const response = await client.models.generateContent({
                model,
                contents,
                config: sanitizeConfigForBackend(backend, config),
            });

            emitEvent(onEvent, {
                type: 'success',
                backend,
                provider: formatBackendLabel(backend),
                taskName,
                model,
                attempt,
                maxAttempts: MAX_ATTEMPTS,
            });

            return {
                text: getResponseText(response),
                backend,
                provider: formatBackendLabel(backend),
                model,
                attempt,
            };
        } catch (error) {
            const retriable = isRetriableError(error) && !isDailyQuotaError(error);
            const message = extractErrorMessage(error);
            const delayMs = retriable ? getRetryDelayMs(attempt, error) : 0;

            emitEvent(onEvent, {
                type: retriable && attempt < MAX_ATTEMPTS ? 'retry' : 'error',
                backend,
                provider: formatBackendLabel(backend),
                taskName,
                model,
                attempt,
                maxAttempts: MAX_ATTEMPTS,
                message,
                status: getErrorStatus(error),
                delayMs,
            });

            if (!retriable || attempt >= MAX_ATTEMPTS) {
                throw error;
            }

            await sleep(delayMs);
        }
    }

    throw new Error(`Unable to complete ${taskName}`);
}

async function generateContent(options) {
    const backendOrder = buildBackendOrder(options.allowFallback !== false);
    const modelOrder = buildModelOrder(options);

    if (!backendOrder.length) {
        throw new Error('No AI backend is configured. Add VERTEX_AI_API_KEY or GEMINI_API_KEY to server/.env.');
    }
    if (!modelOrder.length) {
        throw new Error('No AI model is configured for this request.');
    }

    let lastError = null;

    for (let modelIndex = 0; modelIndex < modelOrder.length; modelIndex += 1) {
        const model = modelOrder[modelIndex];

        for (let backendIndex = 0; backendIndex < backendOrder.length; backendIndex += 1) {
            const backend = backendOrder[backendIndex];

            try {
                return await requestContentFromBackend(backend, {
                    ...options,
                    model,
                });
            } catch (error) {
                lastError = error;
                const nextBackend = backendOrder[backendIndex + 1];
                if (!nextBackend) {
                    continue;
                }

                emitEvent(options.onEvent, {
                    type: 'fallback',
                    from: backend,
                    to: nextBackend,
                    taskName: options.taskName || 'content generation',
                    model,
                    message: extractErrorMessage(error),
                });
            }
        }

        const nextModel = modelOrder[modelIndex + 1];
        if (nextModel) {
            emitEvent(options.onEvent, {
                type: 'model_fallback',
                fromModel: model,
                toModel: nextModel,
                taskName: options.taskName || 'content generation',
                message: extractErrorMessage(lastError),
            });
        }
    }

    throw new Error(`AI request failed: ${extractErrorMessage(lastError)}`);
}

async function generateJson(options) {
    const response = await generateContent({
        ...options,
        config: {
            responseMimeType: 'application/json',
            ...(options.config || {}),
        },
    });

    return {
        ...response,
        data: parseJsonResponse(response.text),
    };
}

module.exports = {
    BACKEND_GEMINI,
    BACKEND_VERTEX,
    formatBackendLabel,
    generateContent,
    generateJson,
    getProviderRuntime,
    __internal: {
        buildBackendOrder,
        isDailyQuotaError,
        getRetryDelayMs,
        getSuggestedRetryDelayMs,
        isRetriableError,
        isUnknownModelError,
        parseJsonResponse,
        sanitizeConfigForBackend,
    },
};
