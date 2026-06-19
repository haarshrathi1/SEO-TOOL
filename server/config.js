const path = require('path');
const dotenv = require('dotenv');

dotenv.config({ path: path.join(__dirname, '.env') });

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

function parseNumber(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseList(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function requireEnv(name) {
    const value = String(process.env[name] || '').trim();
    if (!value) {
        throw new Error(`${name} is required. Add it to server/.env before starting the server.`);
    }
    return value;
}

const nodeEnv = process.env.NODE_ENV || 'development';
const isProduction = nodeEnv === 'production';
const frontendUrl = String(process.env.FRONTEND_URL || 'http://localhost:5173').trim().replace(/\/+$/, '');

const config = {
    nodeEnv,
    isProduction,
    processRole: String(process.env.PROCESS_ROLE || 'web').trim() || 'web',
    port: Math.max(1, parseNumber(process.env.PORT, 3001)),
    frontendUrl,
    mongoUri: String(process.env.MONGODB_URI || '').trim(),
    jwtSecret: requireEnv('JWT_SECRET'),
    startup: {
        retryDelayMs: Math.max(1000, parseNumber(process.env.STARTUP_RETRY_DELAY_MS, 5000)),
    },
    google: {
        clientId: String(process.env.CLIENT_ID || '').trim(),
        clientSecret: String(process.env.CLIENT_SECRET || '').trim(),
        redirectUri: String(process.env.REDIRECT_URI || '').trim(),
        disableServiceAccount: parseBoolean(process.env.DISABLE_SERVICE_ACCOUNT, isProduction),
    },
    session: {
        cookieName: 'seo_session',
        maxAgeMs: 7 * 24 * 60 * 60 * 1000,
    },
    security: {
        csrfHeaderName: 'x-csrf-token',
        enableCanonicalRedirect: parseBoolean(process.env.ENABLE_CANONICAL_REDIRECT, false),
        canonicalHost: String(process.env.CANONICAL_HOST || '').trim(),
        allowSelfRegistration: parseBoolean(process.env.ALLOW_SELF_REGISTRATION, true),
    },
    admin: {
        email: String(process.env.ADMIN_EMAIL || '').trim(),
        emails: parseList(process.env.ADMIN_EMAILS),
    },
    rateLimit: {
        auth: {
            windowMs: Math.max(1000, parseNumber(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000)),
            max: Math.max(1, parseNumber(process.env.AUTH_RATE_LIMIT_MAX, 30)),
        },
        jobs: {
            windowMs: Math.max(1000, parseNumber(process.env.RUN_RATE_LIMIT_WINDOW_MS, 60 * 1000)),
            max: Math.max(1, parseNumber(process.env.RUN_RATE_LIMIT_MAX, 20)),
        },
        ai: {
            windowMs: Math.max(1000, parseNumber(process.env.AI_RATE_LIMIT_WINDOW_MS, 60 * 1000)),
            max: Math.max(1, parseNumber(process.env.AI_RATE_LIMIT_MAX, 30)),
        },
    },
    queue: {
        mode: String(process.env.QUEUE_MODE || '').trim() || (process.env.REDIS_URL ? 'bullmq' : 'inline'),
        redisUrl: String(process.env.REDIS_URL || '').trim(),
    },
};

function assertCoreConfig() {
    if (!config.mongoUri) {
        throw new Error('MONGODB_URI is required. Add it to server/.env before starting the server.');
    }

    if (!config.google.clientId) {
        throw new Error('CLIENT_ID is required. Add it to server/.env before starting the server.');
    }

    if (!config.google.clientSecret) {
        throw new Error('CLIENT_SECRET is required. Add it to server/.env before starting the server.');
    }

    if (!config.google.redirectUri) {
        throw new Error('REDIRECT_URI is required. Add it to server/.env before starting the server.');
    }

    if (config.queue.mode === 'bullmq' && !config.queue.redisUrl) {
        throw new Error('REDIS_URL is required when QUEUE_MODE is bullmq.');
    }
}

module.exports = {
    config,
    assertCoreConfig,
    parseBoolean,
    parseNumber,
};
