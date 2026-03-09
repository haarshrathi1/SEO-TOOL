const { AnalysisHistory } = require('./models');

const addToHistory = async (analysisData, projectId) => {
    try {
        await AnalysisHistory.create({
            projectId,
            data: analysisData,
            timestamp: new Date(),
        });
    } catch (error) {
        console.error('Failed to save analysis history:', error);
    }
};

const getHistory = async () => {
    try {
        const records = await AnalysisHistory.find({}).sort({ timestamp: -1 }).lean();
        return records.map((record) => ({
            id: record._id.toString(),
            timestamp: record.timestamp,
            projectId: record.projectId,
            data: record.data,
        }));
    } catch (error) {
        console.error('Failed to read history:', error);
        return [];
    }
};

module.exports = { addToHistory, getHistory };
