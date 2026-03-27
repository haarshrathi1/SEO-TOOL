const { KeywordFeatureUsage } = require('./models');

const KEYWORD_ADS_FEATURE = 'keyword_ads';
const DEFAULT_WEEKLY_LIMIT = 2;

function parseWeeklyLimit(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        return DEFAULT_WEEKLY_LIMIT;
    }
    return Math.floor(parsed);
}

function getKeywordAdsWeeklyLimit() {
    return parseWeeklyLimit(process.env.DATAFORSEO_ADS_WEEKLY_LIMIT);
}

function getKeywordAdsWeekKey(date = new Date()) {
    const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const day = (utc.getUTCDay() + 6) % 7;
    utc.setUTCDate(utc.getUTCDate() - day);
    return utc.toISOString().slice(0, 10);
}

function hasKeywordAdsFeature(user) {
    if (!user) {
        return false;
    }

    if (user.role === 'admin') {
        return true;
    }

    return Array.isArray(user.features) && user.features.includes(KEYWORD_ADS_FEATURE);
}

function isKeywordAdsConfigured() {
    return Boolean(process.env.DATAFORSEO_LOGIN?.trim() && process.env.DATAFORSEO_PASSWORD?.trim());
}

function normalizeOwnerEmail(value) {
    return String(value || '').toLowerCase().trim();
}

function isDuplicateKeyError(error) {
    return Number(error?.code) === 11000;
}

async function getUsageCount(ownerEmail, weekKey) {
    if (!ownerEmail) {
        return 0;
    }

    const usage = await KeywordFeatureUsage.findOne({
        ownerEmail: String(ownerEmail).toLowerCase().trim(),
        feature: KEYWORD_ADS_FEATURE,
        weekKey,
    }).lean();

    return Number.isFinite(Number(usage?.count)) ? Number(usage.count) : 0;
}

async function getKeywordAdsUsageStatus(user, options = {}) {
    const weekKey = options.weekKey || getKeywordAdsWeekKey();
    const configured = isKeywordAdsConfigured();
    const weeklyLimit = getKeywordAdsWeeklyLimit();
    const isAdmin = user?.role === 'admin';
    const featureEnabled = hasKeywordAdsFeature(user);

    if (!configured) {
        return {
            configured,
            featureEnabled,
            isAdmin,
            allowed: false,
            unlimited: false,
            weeklyLimit,
            usedThisWeek: 0,
            remainingThisWeek: 0,
            weekKey,
            reason: 'not_configured',
        };
    }

    if (!featureEnabled) {
        return {
            configured,
            featureEnabled,
            isAdmin,
            allowed: false,
            unlimited: false,
            weeklyLimit,
            usedThisWeek: 0,
            remainingThisWeek: 0,
            weekKey,
            reason: 'feature_not_enabled',
        };
    }

    if (isAdmin) {
        return {
            configured,
            featureEnabled,
            isAdmin,
            allowed: true,
            unlimited: true,
            weeklyLimit: null,
            usedThisWeek: 0,
            remainingThisWeek: null,
            weekKey,
            reason: 'admin_unlimited',
        };
    }

    const usedThisWeek = await getUsageCount(user.email, weekKey);
    const remainingThisWeek = Math.max(0, weeklyLimit - usedThisWeek);

    return {
        configured,
        featureEnabled,
        isAdmin,
        allowed: remainingThisWeek > 0,
        unlimited: false,
        weeklyLimit,
        usedThisWeek,
        remainingThisWeek,
        weekKey,
        reason: remainingThisWeek > 0 ? 'ok' : 'weekly_limit_reached',
    };
}

async function reserveKeywordAdsUsage(user, options = {}) {
    const status = await getKeywordAdsUsageStatus(user, options);
    if (!status.allowed) {
        return {
            ...status,
            usageApplied: false,
        };
    }

    if (status.unlimited) {
        return {
            ...status,
            usageApplied: false,
        };
    }

    const ownerEmail = normalizeOwnerEmail(user?.email);
    const weeklyLimit = getKeywordAdsWeeklyLimit();

    let nextUsage = await KeywordFeatureUsage.findOneAndUpdate(
        {
            ownerEmail,
            feature: KEYWORD_ADS_FEATURE,
            weekKey: status.weekKey,
            count: { $lt: weeklyLimit },
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
                ownerEmail,
                feature: KEYWORD_ADS_FEATURE,
                weekKey: status.weekKey,
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
                ownerEmail,
                feature: KEYWORD_ADS_FEATURE,
                weekKey: status.weekKey,
                count: { $lt: weeklyLimit },
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
        const refreshedStatus = await getKeywordAdsUsageStatus(user, { weekKey: status.weekKey });
        return {
            ...refreshedStatus,
            usageApplied: false,
        };
    }
    const usedThisWeek = Number(nextUsage?.count || 0);

    return {
        ...status,
        usageApplied: true,
        usedThisWeek,
        remainingThisWeek: Math.max(0, weeklyLimit - usedThisWeek),
    };
}

async function releaseKeywordAdsUsage(user, options = {}) {
    const isAdmin = user?.role === 'admin';
    const weekKey = options.weekKey || getKeywordAdsWeekKey();

    if (!user?.email || isAdmin || !hasKeywordAdsFeature(user)) {
        return {
            ...(await getKeywordAdsUsageStatus(user, { weekKey })),
            usageReleased: false,
        };
    }

    const ownerEmail = normalizeOwnerEmail(user.email);
    const nextUsage = await KeywordFeatureUsage.findOneAndUpdate(
        {
            ownerEmail,
            feature: KEYWORD_ADS_FEATURE,
            weekKey,
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
        await KeywordFeatureUsage.deleteOne({
            ownerEmail,
            feature: KEYWORD_ADS_FEATURE,
            weekKey,
        });
    }

    return {
        ...(await getKeywordAdsUsageStatus(user, { weekKey })),
        usageReleased: Boolean(nextUsage),
    };
}

module.exports = {
    KEYWORD_ADS_FEATURE,
    getKeywordAdsWeekKey,
    getKeywordAdsWeeklyLimit,
    hasKeywordAdsFeature,
    isKeywordAdsConfigured,
    getKeywordAdsUsageStatus,
    releaseKeywordAdsUsage,
    reserveKeywordAdsUsage,
    __internal: {
        isDuplicateKeyError,
        parseWeeklyLimit,
    },
};
