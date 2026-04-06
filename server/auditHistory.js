const { AuditHistory } = require('./models');
const { buildPaginatedResult, parseBefore, parseLimit } = require('./pagination');

function normalizeProjectId(projectId) {
    return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
}

function buildAuditHistoryQuery(user, options = {}) {
    const projectId = normalizeProjectId(options.projectId);
    const query = {};

    if (projectId) {
        query.projectId = projectId;
    }

    if (user?.role === 'viewer') {
        if (!Array.isArray(user.projectIds) || user.projectIds.length === 0) {
            return null;
        }

        if (projectId) {
            if (!user.projectIds.includes(projectId)) {
                return null;
            }
        } else {
            query.projectId = { $in: user.projectIds };
        }
    }

    return query;
}

const addAudit = async (results, projectId) => {
    try {
        const doc = await AuditHistory.create({
            projectId,
            results,
            timestamp: new Date(),
        });

        return {
            id: doc._id.toString(),
            timestamp: doc.timestamp,
            projectId: doc.projectId,
            results: doc.results,
        };
    } catch (error) {
        console.error('Failed to save audit history:', error);
        return null;
    }
};

const getAuditHistory = async (user, options = {}) => {
    const query = buildAuditHistoryQuery(user, options);
    if (!query) {
        return { items: [], hasMore: false, nextBefore: null };
    }

    const limit = parseLimit(options.limit);
    const before = parseBefore(options.before);
    if (before) {
        query.timestamp = { $lt: before };
    }

    try {
        const records = await AuditHistory.find(query).sort({ timestamp: -1 }).limit(limit + 1).lean();
        return buildPaginatedResult(records, limit, (record) => ({
            id: record._id.toString(),
            timestamp: record.timestamp,
            projectId: record.projectId,
            results: record.results,
        }));
    } catch (error) {
        console.error('Failed to read audit history:', error);
        return { items: [], hasMore: false, nextBefore: null };
    }
};

module.exports = {
    addAudit,
    getAuditHistory,
    __internal: {
        normalizeProjectId,
        buildAuditHistoryQuery,
    },
};
