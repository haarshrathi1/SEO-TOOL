const { AuditHistory } = require('./models');

const addAudit = async (results, projectId) => {
    try {
        await AuditHistory.create({
            projectId,
            results,
            timestamp: new Date(),
        });
    } catch (error) {
        console.error('Failed to save audit history:', error);
    }
};

const getAuditHistory = async () => {
    try {
        const records = await AuditHistory.find({}).sort({ timestamp: -1 }).lean();
        return records.map((record) => ({
            id: record._id.toString(),
            timestamp: record.timestamp,
            projectId: record.projectId,
            results: record.results,
        }));
    } catch (error) {
        console.error('Failed to read audit history:', error);
        return [];
    }
};

module.exports = { addAudit, getAuditHistory };
