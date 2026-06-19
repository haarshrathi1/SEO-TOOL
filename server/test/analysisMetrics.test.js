const test = require('node:test');
const assert = require('node:assert/strict');

const analysisMetrics = require('../analysisMetrics');

test('computeVisibilityScore drops as average position gets worse', () => {
    const best = analysisMetrics.__internal.computeVisibilityScore(1);
    const middle = analysisMetrics.__internal.computeVisibilityScore(10);
    const poor = analysisMetrics.__internal.computeVisibilityScore(16.41);

    assert.equal(Number(best.toFixed(2)), 100.00);
    assert.ok(middle < best);
    assert.ok(poor < middle);
    assert.equal(analysisMetrics.resolveVisibility({ avgPosition: '16.41' }), '4.59%');
});

test('normalizeAnalysisData replaces legacy visibility copied from ctr', () => {
    const normalized = analysisMetrics.normalizeAnalysisData({
        metrics: {
            ctr: '0.71%',
            visibility: '0.71%',
            avgPosition: '16.41',
        },
        report: {
            CTR: '0.71%',
            Visibility: '0.71%',
            AvgPosition: '16.41',
        },
    });

    assert.equal(normalized.metrics.visibility, '4.59%');
    assert.equal(normalized.report.Visibility, '4.59%');
});
