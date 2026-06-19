const { getPreferredKeywordAdsProviderConfig } = require('./keywordAdsProviders');
const {
    DAY_PERIOD,
    WEEK_PERIOD,
    getDayKey,
    getWeekKey,
    getUsageCount,
    normalizeOwnerEmail,
    parseLimit,
    releaseUsageCount,
    reserveUsageCount,
} = require('./usageWindows');

const KEYWORD_ADS_FEATURE = 'keyword_ads';
const DEFAULT_WEEKLY_LIMIT = 5;
const DEFAULT_DAILY_LIMIT = 2;

function getKeywordAdsWeeklyLimit() {
    return parseLimit(process.env.GOOGLE_ADS_WEEKLY_LIMIT, DEFAULT_WEEKLY_LIMIT);
}

function getKeywordAdsDailyLimit() {
    return parseLimit(process.env.GOOGLE_ADS_DAILY_LIMIT, DEFAULT_DAILY_LIMIT);
}

function getKeywordAdsWeekKey(date = new Date()) {
    return getWeekKey(date);
}

function getKeywordAdsDayKey(date = new Date()) {
    return getDayKey(date);
}

function hasKeywordAdsFeature(user) {
    if (!user) {
        return false;
    }

    if (user.role === 'admin') {
        return true;
    }

    return Array.isArray(user.access) && user.access.includes('keywords');
}

function isKeywordAdsConfigured() {
    return getPreferredKeywordAdsProviderConfig().configured;
}

function buildBaseStatus(user, options = {}) {
    const providerConfig = getPreferredKeywordAdsProviderConfig();
    const configured = providerConfig.configured;
    const dailyLimit = getKeywordAdsDailyLimit();
    const weeklyLimit = getKeywordAdsWeeklyLimit();
    const dayKey = options.dayKey || getKeywordAdsDayKey();
    const weekKey = options.weekKey || getKeywordAdsWeekKey();
    const isAdmin = user?.role === 'admin';
    const featureEnabled = hasKeywordAdsFeature(user);

    return {
        provider: providerConfig.provider,
        providerLabel: providerConfig.providerLabel,
        configured,
        configurationReason: providerConfig.reason || 'ok',
        featureEnabled,
        isAdmin,
        allowed: false,
        unlimited: false,
        dailyLimit,
        usedToday: 0,
        remainingToday: 0,
        weeklyLimit,
        usedThisWeek: 0,
        remainingThisWeek: 0,
        locationCode: providerConfig.locationCode ?? null,
        languageCode: providerConfig.languageCode ?? '',
        searchPartners: providerConfig.searchPartners ?? false,
        dayKey,
        weekKey,
        reason: 'ok',
    };
}

async function getKeywordAdsUsageStatus(user, options = {}) {
    const baseStatus = buildBaseStatus(user, options);

    if (!baseStatus.configured) {
        return {
            ...baseStatus,
            reason: 'not_configured',
        };
    }

    if (!baseStatus.featureEnabled) {
        return {
            ...baseStatus,
            reason: 'feature_not_enabled',
        };
    }

    if (baseStatus.isAdmin) {
        return {
            ...baseStatus,
            allowed: true,
            unlimited: true,
            dailyLimit: null,
            remainingToday: null,
            weeklyLimit: null,
            remainingThisWeek: null,
            reason: 'admin_unlimited',
        };
    }

    const ownerEmail = normalizeOwnerEmail(user?.email);
    const [usedToday, usedThisWeek] = await Promise.all([
        getUsageCount({
            scope: 'user',
            ownerEmail,
            feature: KEYWORD_ADS_FEATURE,
            period: DAY_PERIOD,
            windowKey: baseStatus.dayKey,
        }),
        getUsageCount({
            scope: 'user',
            ownerEmail,
            feature: KEYWORD_ADS_FEATURE,
            period: WEEK_PERIOD,
            windowKey: baseStatus.weekKey,
        }),
    ]);

    const remainingToday = Math.max(0, baseStatus.dailyLimit - usedToday);
    const remainingThisWeek = Math.max(0, baseStatus.weeklyLimit - usedThisWeek);
    const allowed = remainingToday > 0 && remainingThisWeek > 0;
    const reason = remainingToday <= 0
        ? 'daily_limit_reached'
        : remainingThisWeek <= 0
            ? 'weekly_limit_reached'
            : 'ok';

    return {
        ...baseStatus,
        allowed,
        usedToday,
        remainingToday,
        usedThisWeek,
        remainingThisWeek,
        reason,
    };
}

async function reserveKeywordAdsUsage(user, options = {}) {
    const status = await getKeywordAdsUsageStatus(user, options);
    if (!status.allowed || status.unlimited) {
        return {
            ...status,
            usageApplied: false,
        };
    }

    const ownerEmail = normalizeOwnerEmail(user?.email);
    const dailyReservation = await reserveUsageCount({
        scope: 'user',
        ownerEmail,
        feature: KEYWORD_ADS_FEATURE,
        period: DAY_PERIOD,
        windowKey: status.dayKey,
        limit: status.dailyLimit,
    });

    if (!dailyReservation.applied) {
        return {
            ...(await getKeywordAdsUsageStatus(user, { dayKey: status.dayKey, weekKey: status.weekKey })),
            usageApplied: false,
        };
    }

    const weeklyReservation = await reserveUsageCount({
        scope: 'user',
        ownerEmail,
        feature: KEYWORD_ADS_FEATURE,
        period: WEEK_PERIOD,
        windowKey: status.weekKey,
        limit: status.weeklyLimit,
    });

    if (!weeklyReservation.applied) {
        await releaseUsageCount({
            scope: 'user',
            ownerEmail,
            feature: KEYWORD_ADS_FEATURE,
            period: DAY_PERIOD,
            windowKey: status.dayKey,
        });
        return {
            ...(await getKeywordAdsUsageStatus(user, { dayKey: status.dayKey, weekKey: status.weekKey })),
            usageApplied: false,
        };
    }

    return {
        ...status,
        usageApplied: true,
        usedToday: dailyReservation.count,
        remainingToday: Math.max(0, status.dailyLimit - dailyReservation.count),
        usedThisWeek: weeklyReservation.count,
        remainingThisWeek: Math.max(0, status.weeklyLimit - weeklyReservation.count),
    };
}

async function releaseKeywordAdsUsage(user, options = {}) {
    const status = await getKeywordAdsUsageStatus(user, options);
    if (!user?.email || status.unlimited || !status.featureEnabled) {
        return {
            ...status,
            usageReleased: false,
        };
    }

    const ownerEmail = normalizeOwnerEmail(user.email);
    const [dailyRelease, weeklyRelease] = await Promise.all([
        releaseUsageCount({
            scope: 'user',
            ownerEmail,
            feature: KEYWORD_ADS_FEATURE,
            period: DAY_PERIOD,
            windowKey: status.dayKey,
        }),
        releaseUsageCount({
            scope: 'user',
            ownerEmail,
            feature: KEYWORD_ADS_FEATURE,
            period: WEEK_PERIOD,
            windowKey: status.weekKey,
        }),
    ]);

    return {
        ...(await getKeywordAdsUsageStatus(user, { dayKey: status.dayKey, weekKey: status.weekKey })),
        usageReleased: dailyRelease.released || weeklyRelease.released,
    };
}

module.exports = {
    KEYWORD_ADS_FEATURE,
    getKeywordAdsDayKey,
    getKeywordAdsWeekKey,
    getKeywordAdsDailyLimit,
    getKeywordAdsWeeklyLimit,
    hasKeywordAdsFeature,
    isKeywordAdsConfigured,
    getKeywordAdsUsageStatus,
    releaseKeywordAdsUsage,
    reserveKeywordAdsUsage,
    __internal: {
        parseLimit,
    },
};
