const keywordHistory = require('./keywordHistory');

async function persistKeywordResearchResult(user, result, options = {}, dependencies = {}) {
    if (!user?.email || !result) {
        return {
            keywordHistoryId: null,
            historySaveError: '',
        };
    }

    const saveResearch = dependencies.saveResearch || keywordHistory.saveResearch;

    try {
        const saved = await saveResearch(user, result, { projectId: options.projectId || result.projectId || null });
        return {
            keywordHistoryId: saved?.id || null,
            historySaveError: '',
        };
    } catch (error) {
        const historySaveError = error instanceof Error ? error.message : 'Failed to save keyword research history';
        console.error('[Keyword Research] Auto-save failed:', historySaveError);
        return {
            keywordHistoryId: null,
            historySaveError,
        };
    }
}

module.exports = {
    persistKeywordResearchResult,
};
