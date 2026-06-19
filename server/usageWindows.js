const { KeywordFeatureUsage } = require('./models');

const DAY_PERIOD = 'day';
const WEEK_PERIOD = 'week';

function normalizeOwnerEmail(value) {
    return typeof value === 'string' ? value.toLowerCase().trim() : '';
}

function parseLimit(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

function getDayKey(date = new Date()) {
    return date.toISOString().slice(0, 10);
}

function getWeekKey(date = new Date()) {
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = (utc.getUTCDay() + 6) % 7;
    utc.setUTCDate(utc.getUTCDate() - day);
    return utc.toISOString().slice(0, 10);
}

function buildUsageQuery(options = {}) {
    return {
        scope: options.scope || 'user',
        ownerEmail: normalizeOwnerEmail(options.ownerEmail),
        feature: String(options.feature || '').trim(),
        period: String(options.period || '').trim(),
        windowKey: String(options.windowKey || '').trim(),
    };
}

function isDuplicateKeyError(error) {
    return Number(error?.code) === 11000;
}

async function getUsageCount(options = {}) {
    const query = buildUsageQuery(options);
    const usage = await KeywordFeatureUsage.findOne(query).lean();
    return Number.isFinite(Number(usage?.count)) ? Number(usage.count) : 0;
}

async function reserveUsageCount(options = {}) {
    const query = buildUsageQuery(options);
    const limit = parseLimit(options.limit, 0);
    if (limit <= 0) {
        return { applied: false, count: await getUsageCount(query) };
    }

    let nextUsage = await KeywordFeatureUsage.findOneAndUpdate(
        {
            ...query,
            count: { $lt: limit },
        },
        {
            $inc: { count: 1 },
        },
        {
            new: true,
        }
    ).lean();

    if (!nextUsage) {
        try {
            nextUsage = await KeywordFeatureUsage.create({
                ...query,
                count: 1,
            });
            nextUsage = typeof nextUsage.toObject === 'function' ? nextUsage.toObject() : nextUsage;
        } catch (error) {
            if (!isDuplicateKeyError(error)) {
                throw error;
            }
        }
    }

    if (!nextUsage) {
        nextUsage = await KeywordFeatureUsage.findOneAndUpdate(
            {
                ...query,
                count: { $lt: limit },
            },
            {
                $inc: { count: 1 },
            },
            {
                new: true,
            }
        ).lean();
    }

    if (!nextUsage) {
        return {
            applied: false,
            count: await getUsageCount(query),
        };
    }

    return {
        applied: true,
        count: Number(nextUsage.count || 0),
    };
}

async function releaseUsageCount(options = {}) {
    const query = buildUsageQuery(options);
    const nextUsage = await KeywordFeatureUsage.findOneAndUpdate(
        {
            ...query,
            count: { $gt: 0 },
        },
        {
            $inc: { count: -1 },
        },
        {
            new: true,
        }
    ).lean();

    if (nextUsage?.count === 0) {
        await KeywordFeatureUsage.deleteOne(query);
    }

    return {
        released: Boolean(nextUsage),
        count: Number(nextUsage?.count || 0),
    };
}

module.exports = {
    DAY_PERIOD,
    WEEK_PERIOD,
    normalizeOwnerEmail,
    parseLimit,
    getDayKey,
    getWeekKey,
    getUsageCount,
    reserveUsageCount,
    releaseUsageCount,
    __internal: {
        buildUsageQuery,
        isDuplicateKeyError,
    },
};
