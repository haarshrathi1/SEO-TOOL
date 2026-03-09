const { KeywordResearch } = require('./models');

async function getHistory() {
    try {
        const records = await KeywordResearch.find({}).sort({ timestamp: -1 }).lean();
        return records.map((record) => ({
            id: record._id.toString(),
            timestamp: record.timestamp,
            ...(record.payload || {}),
        }));
    } catch (e) {
        console.error('Failed to read keyword history:', e.message);
        return [];
    }
}

async function saveResearch(data) {
    const doc = await KeywordResearch.create({
        seed: data?.seed || null,
        payload: data,
        timestamp: new Date(),
    });

    return {
        id: doc._id.toString(),
        timestamp: doc.timestamp,
        ...data,
    };
}

module.exports = { getHistory, saveResearch };
