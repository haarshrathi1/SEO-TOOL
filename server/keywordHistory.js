const { KeywordResearch } = require('./models');
const { buildPaginatedResult, parseBefore, parseLimit } = require('./pagination');

function normalizeProjectId(projectId) {
    return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
}

function buildHistoryQuery(user, options = {}) {
    const projectId = normalizeProjectId(options.projectId);

    if (user.role === 'admin' && projectId) {
        return { projectId };
    }

    const query = user.role === 'admin'
        ? {
            $or: [
                { ownerEmail: user.email },
                { ownerEmail: { $exists: false } },
            ],
        }
        : { ownerEmail: user.email };

    if (projectId) {
        query.projectId = projectId;
    }

    return query;
}

async function getHistory(user, options = {}) {
    const query = buildHistoryQuery(user, options);
    const limit = parseLimit(options.limit);
    const before = parseBefore(options.before);
    if (before) {
        query.timestamp = { $lt: before };
    }

    try {
        const records = await KeywordResearch.find(query).sort({ timestamp: -1 }).limit(limit + 1).lean();
        return buildPaginatedResult(records, limit, (record) => ({
            id: record._id.toString(),
            timestamp: record.timestamp,
            ownerEmail: record.ownerEmail || user.email,
            projectId: record.projectId || null,
            ...(record.payload || {}),
        }));
    } catch (e) {
        console.error('Failed to read keyword history:', e.message);
        return { items: [], hasMore: false, nextBefore: null };
    }
}

async function saveResearch(user, data, options = {}) {
    const projectId = normalizeProjectId(options.projectId || data?.projectId);
    const doc = await KeywordResearch.create({
        seed: data?.seed || null,
        ownerEmail: user.email,
        projectId,
        payload: {
            ...(data || {}),
            projectId,
        },
        timestamp: new Date(),
    });

    return {
        id: doc._id.toString(),
        timestamp: doc.timestamp,
        ownerEmail: doc.ownerEmail,
        projectId: doc.projectId,
        ...data,
        projectId,
    };
}

module.exports = {
    getHistory,
    saveResearch,
    __internal: {
        normalizeProjectId,
        buildHistoryQuery,
    },
};
