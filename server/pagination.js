const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

function parseLimit(value, fallback = DEFAULT_LIMIT) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.min(MAX_LIMIT, Math.floor(parsed));
}

function parseBefore(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return null;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

function buildPaginatedResult(records, limit, mapRecord) {
    const safeRecords = Array.isArray(records) ? records : [];
    const items = safeRecords.slice(0, limit).map(mapRecord);
    const hasMore = safeRecords.length > limit;
    const nextBefore = hasMore
        ? items[items.length - 1]?.timestamp || null
        : null;

    return {
        items,
        hasMore,
        nextBefore,
    };
}

module.exports = {
    DEFAULT_LIMIT,
    MAX_LIMIT,
    parseLimit,
    parseBefore,
    buildPaginatedResult,
};
