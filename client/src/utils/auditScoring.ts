import type { AuditResult } from '../types';

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function getPsiRatio(score?: number) {
    if (typeof score !== 'number' || Number.isNaN(score)) {
        return 0.5;
    }

    return clamp(score, 0, 100) / 100;
}

export function calculateAuditHealth(results: AuditResult[]) {
    if (!results.length) return 0;

    const total = results.length;
    let score = 100;

    const criticalCount = results.filter((result) =>
        result.status !== 'PASS'
        || (result.httpStatus || 0) >= 400
        || !!result.isNoindex
        || result.h1Count === 0
    ).length;

    const warningCount = results.filter((result) =>
        !result.description
        || (result.wordCount || 0) < 300
        || !!result.duplicateTitle
        || !!result.duplicateDescription
        || !!result.canonicalIssue
        || !result.canonicalUrl
        || !result.schemaCount
        || (result.missingAltCount || 0) > 0
        || !result.lang
    ).length;

    score -= (criticalCount / total) * 45;
    score -= (warningCount / total) * 25;

    const psiAverage = results.reduce((sum, result) => sum + getPsiRatio(result.psi_data?.desktop?.score), 0) / total;
    score -= (1 - psiAverage) * 30;

    return Math.round(clamp(score, 0, 100));
}

export function countHealthyPages(results: AuditResult[]) {
    return results.filter((result) =>
        result.status === 'PASS'
        && !!result.description
        && result.h1Count === 1
        && !result.isNoindex
        && !result.canonicalIssue
        && (result.httpStatus || 200) < 400
    ).length;
}
