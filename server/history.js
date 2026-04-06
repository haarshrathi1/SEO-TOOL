const { AnalysisHistory } = require('./models');
const { buildPaginatedResult, parseBefore, parseLimit } = require('./pagination');

const LEGACY_DEFAULT_PROJECT_ID = 'laserlift';

function normalizeProjectId(projectId) {
    return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
}

function buildHistoryQuery(user, options = {}) {
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
    } else if (projectId === LEGACY_DEFAULT_PROJECT_ID) {
        delete query.projectId;
        query.$or = [
            { projectId },
            { projectId: { $exists: false } },
            { projectId: null },
        ];
    }

    return query;
}

const addToHistory = async (analysisData, projectId) => {
    try {
        const doc = await AnalysisHistory.create({
            projectId,
            data: analysisData,
            timestamp: new Date(),
        });

        return {
            id: doc._id.toString(),
            timestamp: doc.timestamp,
            projectId: doc.projectId,
            data: doc.data,
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
            data: record.data,
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
    },
};
