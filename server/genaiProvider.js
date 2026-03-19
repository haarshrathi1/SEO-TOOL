require('dotenv').config();

const { GoogleGenAI } = require('@google/genai');

const BACKEND_VERTEX = 'vertex';
const BACKEND_GEMINI = 'gemini';
const DEFAULT_API_VERSION = process.env.GENAI_API_VERSION || 'v1';
const DEFAULT_LOCATION = process.env.GOOGLE_CLOUD_LOCATION || 'global';
const MAX_ATTEMPTS = Math.max(1, Number(process.env.GENAI_RETRY_ATTEMPTS || 4));
const BASE_RETRY_DELAY_MS = Math.max(250, Number(process.env.GENAI_RETRY_BASE_DELAY_MS || 1200));

let vertexClient = null;
let geminiClient = null;

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
    process.env.GENAI_PAGE_MODEL || process.env.GEMINI_PAGE_MODEL || 'gemini-2.5-flash'
)[0] || 'gemini-2.5-flash';
const DEFAULT_PAGE_MODEL_FALLBACKS = uniqueValues(parseModelList(
    process.env.GENAI_PAGE_MODEL_FALLBACKS || process.env.GEMINI_PAGE_MODEL_FALLBACKS || ''
));
const DEFAULT_KEYWORD_MODELS = uniqueValues([
    ...parseModelList(process.env.GENAI_KEYWORD_MODEL || process.env.GEMINI_KEYWORD_MODEL || 'gemini-3.1-pro-preview'),
    ...parseModelList(process.env.GENAI_KEYWORD_MODEL_FALLBACKS || process.env.GEMINI_KEYWORD_MODEL_FALLBACKS || 'gemini-2.5-pro'),
]);
const DEFAULT_KEYWORD_MODEL = DEFAULT_KEYWORD_MODELS[0] || 'gemini-3.1-pro-preview';
const DEFAULT_KEYWORD_MODEL_FALLBACKS = DEFAULT_KEYWORD_MODELS.slice(1);
const DEFAULT_GROUNDED_SEARCH_MODEL = parseModelList(
    process.env.GENAI_GROUNDED_SEARCH_MODEL || process.env.GEMINI_GROUNDED_SEARCH_MODEL || 'gemini-2.5-flash'
)[0] || 'gemini-2.5-flash';

function getVertexApiKey() {
    return process.env.VERTEX_AI_API_KEY || process.env.GOOGLE_VERTEX_API_KEY || '';
}

function getGeminiApiKey() {
    return process.env.GEMINI_API_KEY || process.env.GEMINI_KEYWORD_API_KEY || process.env.GOOGLE_API_KEY || '';
}

function hasVertexBackend() {
    return Boolean(getVertexApiKey() || process.env.GOOGLE_GENAI_USE_VERTEXAI === 'true' || process.env.GOOGLE_CLOUD_PROJECT);
}

function hasGeminiBackend() {
    return Boolean(getGeminiApiKey());
}

function getPrimaryBackend() {
    const configured = (process.env.GENAI_PRIMARY_BACKEND || '').trim().toLowerCase();
    if (configured === BACKEND_VERTEX || configured === BACKEND_GEMINI) {
        return configured;
    }

    return hasVertexBackend() ? BACKEND_VERTEX : BACKEND_GEMINI;
}

function getProviderRuntime() {
    return {
        primaryBackend: getPrimaryBackend(),
        availableBackends: [hasVertexBackend() ? BACKEND_VERTEX : null, hasGeminiBackend() ? BACKEND_GEMINI : null].filter(Boolean),
        allowGeminiFallback: process.env.GENAI_ENABLE_GEMINI_FALLBACK !== 'false',
        retryAttempts: MAX_ATTEMPTS,
        pageModel: DEFAULT_PAGE_MODEL,
        pageModelFallbacks: DEFAULT_PAGE_MODEL_FALLBACKS,
        keywordModel: DEFAULT_KEYWORD_MODEL,
        keywordModelFallbacks: DEFAULT_KEYWORD_MODEL_FALLBACKS,
        groundedSearchModel: DEFAULT_GROUNDED_SEARCH_MODEL,
        location: DEFAULT_LOCATION,
    };
}

function formatBackendLabel(backend) {
    return backend === BACKEND_VERTEX ? 'Vertex AI' : 'Gemini API';
}

function buildClient(backend) {
    if (backend === BACKEND_VERTEX) {
        const apiKey = getVertexApiKey();

        if (apiKey) {
            return new GoogleGenAI({
                vertexai: true,
                apiKey,
                apiVersion: process.env.GENAI_VERTEX_API_VERSION || DEFAULT_API_VERSION,
            });
        }

        const options = {
            vertexai: true,
            apiVersion: process.env.GENAI_VERTEX_API_VERSION || DEFAULT_API_VERSION,
            location: DEFAULT_LOCATION,
        };

        const project = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || '';
        if (project) {
            options.project = project;
        }

        return new GoogleGenAI(options);
    }

    return new GoogleGenAI({
        apiKey: getGeminiApiKey(),
        apiVersion: DEFAULT_API_VERSION,
    });
}

function getClient(backend) {
    if (backend === BACKEND_VERTEX) {
        if (!vertexClient) {
            vertexClient = buildClient(BACKEND_VERTEX);
        }
        return vertexClient;
    }

    if (!geminiClient) {
        geminiClient = buildClient(BACKEND_GEMINI);
    }

    return geminiClient;
}

function buildBackendOrder(preferredBackend, allowFallback = true) {
    const primary = preferredBackend || getPrimaryBackend();
    const order = [];

    if (primary === BACKEND_VERTEX && hasVertexBackend()) {
        order.push(BACKEND_VERTEX);
    }
    if (primary === BACKEND_GEMINI && hasGeminiBackend()) {
        order.push(BACKEND_GEMINI);
    }

    if (allowFallback) {
        if (!order.includes(BACKEND_VERTEX) && hasVertexBackend()) {
            order.push(BACKEND_VERTEX);
        }
        if (!order.includes(BACKEND_GEMINI) && hasGeminiBackend()) {
            order.push(BACKEND_GEMINI);
        }
    }

    return order;
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

function getRetryDelayMs(attempt) {
    const jitter = Math.floor(Math.random() * 250);
    return BASE_RETRY_DELAY_MS * (2 ** Math.max(0, attempt - 1)) + jitter;
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

function sanitizeConfigForBackend(backend, config = {}) {
    if (!config || typeof config !== 'object') {
        return {};
    }

    const nextConfig = { ...config };

    // Some backends lag behind the latest thinking options, so keep tool / JSON
    // config intact but strip the most compatibility-sensitive setting.
    delete nextConfig.thinkingConfig;

    return nextConfig;
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
            const retriable = isRetriableError(error);
            const message = extractErrorMessage(error);

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
            });

            if (!retriable || attempt >= MAX_ATTEMPTS) {
                throw error;
            }

            await sleep(getRetryDelayMs(attempt));
        }
    }

    throw new Error(`Unable to complete ${taskName}`);
}

async function generateContent(options) {
    const backendOrder = buildBackendOrder(options.preferredBackend, options.allowFallback !== false);
    const modelOrder = buildModelOrder(options);

    if (!backendOrder.length) {
        throw new Error('No AI backend is configured. Add VERTEX_AI_API_KEY for Vertex AI and optionally GEMINI_API_KEY as fallback.');
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
};
