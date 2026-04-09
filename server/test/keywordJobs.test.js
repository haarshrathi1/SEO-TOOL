const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../keywordJobs');

test('serializeJob exposes history save metadata and omits the legacy options flag', () => {
    const serialized = __internal.serializeJob({
        id: 'job-1',
        seed: 'crm software',
        ownerEmail: 'viewer@example.com',
        status: 'completed',
        progress: {
            stage: 'Completed',
            label: 'Completed',
            currentLayer: 5,
            totalLayers: 5,
            completed: 5,
            total: 5,
            percent: 100,
            message: 'done',
            provider: 'Vertex',
        },
        error: '',
        keywordHistoryId: 'history-1',
        historySaveError: '',
        createdAt: '2026-04-08T00:00:00.000Z',
        updatedAt: '2026-04-08T00:01:00.000Z',
        startedAt: '2026-04-08T00:00:05.000Z',
        completedAt: '2026-04-08T00:01:00.000Z',
        options: { useAdsData: true },
    });

    assert.equal(serialized.keywordHistoryId, 'history-1');
    assert.equal(serialized.historySaveError, '');
    assert.equal('options' in serialized, false);
});
