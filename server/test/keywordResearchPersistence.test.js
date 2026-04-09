const test = require('node:test');
const assert = require('node:assert/strict');

const { persistKeywordResearchResult } = require('../keywordResearchPersistence');

test('persistKeywordResearchResult returns the saved history id on success', async () => {
    const outcome = await persistKeywordResearchResult(
        { email: 'viewer@example.com' },
        { seed: 'crm software', projectId: 'crm' },
        { projectId: 'crm' },
        {
            saveResearch: async () => ({ id: 'history-123' }),
        }
    );

    assert.deepEqual(outcome, {
        keywordHistoryId: 'history-123',
        historySaveError: '',
    });
});

test('persistKeywordResearchResult keeps the run successful when history saving fails', async () => {
    const outcome = await persistKeywordResearchResult(
        { email: 'viewer@example.com' },
        { seed: 'crm software', projectId: 'crm' },
        { projectId: 'crm' },
        {
            saveResearch: async () => {
                throw new Error('database offline');
            },
        }
    );

    assert.deepEqual(outcome, {
        keywordHistoryId: null,
        historySaveError: 'database offline',
    });
});

test('persistKeywordResearchResult no-ops when the user or result is missing', async () => {
    const outcome = await persistKeywordResearchResult(null, null);

    assert.deepEqual(outcome, {
        keywordHistoryId: null,
        historySaveError: '',
    });
});
