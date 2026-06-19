const { AnalysisHistory } = require('./models');
const { buildPaginatedResult, parseBefore, parseLimit } = require('./pagination');
const { normalizeAnalysisData } = require('./analysisMetrics');

function normalizeProjectId(projectId) {
    return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
}

function buildHistoryQuery(user, options = {}) {
    const projectId = normalizeProjectId(options.projectId);
    const query = {};

    if (user?.workspaceId) {
        query.workspaceId = user.workspaceId;
    }

    if (projectId) {
        query.projectId = projectId;
    }

    const effectiveRole = user?.workspaceRole || user?.role;
    if (effectiveRole === 'viewer') {
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

const addToHistory = async (analysisData, projectId, workspaceId = null) => {
    try {
        const normalizedAnalysisData = normalizeAnalysisData(analysisData);
        const doc = await AnalysisHistory.create({
            workspaceId,
            projectId,
            data: normalizedAnalysisData,
            timestamp: new Date(),
        });

        return {
            id: doc._id.toString(),
            timestamp: doc.timestamp,
            projectId: doc.projectId,
            data: normalizedAnalysisData,
        };
    } catch (error) {
        console.error('Failed to save analysis history:', error);
        return null;
    }
};

const getHistory = async (user, options = {}) => {
    const query = buildHistoryQuery(user, options);
    if (!query) {
        return { items: [], hasMore: false, nextBefore: null };
    }

    const limit = parseLimit(options.limit);
    const before = parseBefore(options.before);
    if (before) {
        query.timestamp = { $lt: before };
    }

    try {
        const records = await AnalysisHistory.find(query).sort({ timestamp: -1 }).limit(limit + 1).lean();
        return buildPaginatedResult(records, limit, (record) => ({
            id: record._id.toString(),
            timestamp: record.timestamp,
            projectId: record.projectId,
            data: normalizeAnalysisData(record.data),
        }));
    } catch (error) {
        console.error('Failed to read history:', error);
        return { items: [], hasMore: false, nextBefore: null };
    }
};

module.exports = {
    addToHistory,
    getHistory,
    __internal: {
        normalizeProjectId,
        buildHistoryQuery,
        normalizeAnalysisData,
    },
};
