require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
let connectPromise = null;

const RETRIABLE_MONGO_ERROR_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENETUNREACH',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
]);

const RETRIABLE_MONGO_ERROR_NAMES = new Set([
    'MongoNetworkError',
    'MongoServerSelectionError',
    'MongooseServerSelectionError',
]);

function extractMongoErrorSignals(error) {
    const signals = new Set();
    let current = error;

    while (current) {
        if (typeof current.code === 'string' && current.code.trim()) {
            signals.add(current.code.trim());
        }

        if (typeof current.name === 'string' && current.name.trim()) {
            signals.add(current.name.trim());
        }

        if (!current.cause || current.cause === current) {
            break;
        }

        current = current.cause;
    }

    return signals;
}

function isRetriableMongoError(error) {
    const signals = extractMongoErrorSignals(error);
    for (const signal of signals) {
        if (RETRIABLE_MONGO_ERROR_CODES.has(signal) || RETRIABLE_MONGO_ERROR_NAMES.has(signal)) {
            return true;
        }
    }

    const message = String(error?.message || '').toLowerCase();
    return /getaddrinfo|server selection timed out|timed out after|failed to connect|topology was destroyed/.test(message);
}

async function connectMongo() {
    if (mongoose.connection.readyState === 1) {
        return mongoose.connection;
    }

    if (!MONGODB_URI) {
        throw new Error('MONGODB_URI is missing. Add it to server/.env');
    }

    if (!connectPromise) {
        connectPromise = mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
        }).then(() => {
            console.log('[MongoDB] Connected');
            return mongoose.connection;
        }).catch((error) => {
            connectPromise = null;
            throw error;
        });
    }

    return connectPromise;
}

module.exports = {
    mongoose,
    connectMongo,
    __internal: {
        extractMongoErrorSignals,
        isRetriableMongoError,
    },
};

