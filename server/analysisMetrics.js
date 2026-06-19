function toFiniteNumber(value) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'string') {
        const normalized = value.replace(/[^0-9.-]/g, '');
        if (!normalized) {
            return null;
        }

        const parsed = Number.parseFloat(normalized);
        return Number.isFinite(parsed) ? parsed : null;
    }

    return null;
}

function formatPercent(value) {
    const parsed = toFiniteNumber(value);
    const safeValue = parsed === null ? 0 : Math.max(0, Math.min(parsed, 100));
    return `${safeValue.toFixed(2)}%`;
}

function computeVisibilityScore(avgPosition) {
    const position = toFiniteNumber(avgPosition);
    if (position === null || position <= 0) {
        return null;
    }

    // Approximate ranking visibility using a smooth exponential decay curve.
    return Math.exp(-(position - 1) / 5) * 100;
}

function resolveVisibility(metrics = {}, report = null) {
    const avgPosition = metrics.avgPosition ?? report?.AvgPosition;
    const computedVisibility = computeVisibilityScore(avgPosition);
    if (computedVisibility !== null) {
        return formatPercent(computedVisibility);
    }

    return formatPercent(metrics.visibility ?? report?.Visibility);
}

function normalizeAnalysisData(analysisData) {
    if (!analysisData || typeof analysisData !== 'object') {
        return analysisData;
    }

    const nextMetrics = analysisData.metrics && typeof analysisData.metrics === 'object'
        ? { ...analysisData.metrics }
        : null;
    const nextReport = analysisData.report && typeof analysisData.report === 'object'
        ? { ...analysisData.report }
        : null;

    if (!nextMetrics) {
        return analysisData;
    }

    const visibility = resolveVisibility(nextMetrics, nextReport);
    nextMetrics.visibility = visibility;

    if (nextReport) {
        nextReport.Visibility = visibility;
    }

    return {
        ...analysisData,
        metrics: nextMetrics,
        ...(nextReport ? { report: nextReport } : {}),
    };
}

module.exports = {
    normalizeAnalysisData,
    resolveVisibility,
    __internal: {
        computeVisibilityScore,
        formatPercent,
        toFiniteNumber,
    },
};
