const test = require('node:test');
const assert = require('node:assert/strict');

const demo = require('../demo');

test('buildDemoSummary aligns the audit snapshot to the latest analysis project', () => {
    const summary = demo.__internal.buildDemoSummary({
        analysisRecords: [
            {
                id: 'analysis-1',
                timestamp: '2026-04-10T12:00:00.000Z',
                projectId: 'alpha',
                data: {
                    metrics: {
                        ctr: '1.20%',
                        visibility: '1.20%',
                        avgPosition: '12',
                    },
                },
            },
        ],
        auditRecords: [
            {
                id: 'audit-other',
                timestamp: '2026-04-12T12:00:00.000Z',
                projectId: 'beta',
                results: [{ url: 'https://beta.test', status: 'FAIL' }],
            },
            {
                id: 'audit-match',
                timestamp: '2026-04-11T12:00:00.000Z',
                projectId: 'alpha',
                results: [{ url: 'https://alpha.test', status: 'PASS' }],
            },
        ],
        keywordRecords: [
            {
                id: 'keyword-1',
                timestamp: '2026-04-09T12:00:00.000Z',
                seed: 'crm software',
                keywordUniverse: { keywords: [] },
                strategy: {},
                metadata: {},
            },
        ],
    });

    assert.equal(summary.analysis?.projectId, 'alpha');
    assert.equal(summary.audit?.id, 'audit-match');
    assert.equal(summary.keyword?.id, 'keyword-1');
    assert.equal(summary.analysis?.data.metrics.visibility, '11.08%');
});

test('buildDemoSummary falls back cleanly when data files are empty', () => {
    const summary = demo.__internal.buildDemoSummary();

    assert.equal(summary.analysis, null);
    assert.equal(summary.audit, null);
    assert.equal(summary.keyword, null);
    assert.match(summary.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});
