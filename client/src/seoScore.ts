import type { AuditResult } from './types';

export interface SeoScoreCategory {
    score: number;
    max: number;
    reason: string;
}

export interface SeoScoreBreakdown {
    total: number;
    label: 'Excellent' | 'Good' | 'Needs Work' | 'Poor';
    title: SeoScoreCategory;
    description: SeoScoreCategory;
    h1: SeoScoreCategory;
    content: SeoScoreCategory;
    canonical: SeoScoreCategory;
    speed: SeoScoreCategory;
    indexation: SeoScoreCategory;
}

export function computeSeoScore(result: AuditResult): SeoScoreBreakdown {
    const httpError = typeof result.httpStatus === 'number' && result.httpStatus >= 400;
    const blocked = Boolean(result.contentBlocked) || httpError;

    // ── Title (20 pts) ──────────────────────────────────────────
    let titleScore = 0;
    let titleReason = 'Missing title tag';
    if (blocked) {
        titleScore = 10;
        titleReason = 'Page not accessible';
    } else {
        const len = result.title?.trim().length ?? 0;
        if (len >= 30 && len <= 60) { titleScore = 20; titleReason = `Good length (${len} chars)`; }
        else if (len >= 20 && len <= 70) { titleScore = 12; titleReason = `Acceptable length (${len} chars — target 30–60)`; }
        else if (len > 70) { titleScore = 6; titleReason = `Too long (${len} chars — target 30–60)`; }
        else if (len > 0) { titleScore = 6; titleReason = `Too short (${len} chars — target 30–60)`; }
    }

    // ── Meta Description (15 pts) ───────────────────────────────
    let descScore = 0;
    let descReason = 'Missing meta description';
    if (blocked) {
        descScore = 8;
        descReason = 'Page not accessible';
    } else {
        const len = result.description?.trim().length ?? 0;
        if (len >= 120 && len <= 160) { descScore = 15; descReason = `Good length (${len} chars)`; }
        else if (len >= 80 && len <= 180) { descScore = 9; descReason = `Acceptable length (${len} chars — target 120–160)`; }
        else if (len > 180) { descScore = 5; descReason = `Too long (${len} chars — target 120–160)`; }
        else if (len > 0) { descScore = 5; descReason = `Too short (${len} chars — target 120–160)`; }
    }

    // ── H1 (15 pts) ─────────────────────────────────────────────
    let h1Score = 0;
    let h1Reason = 'No H1 tag found';
    if (blocked) {
        h1Score = 8;
        h1Reason = 'Page not accessible';
    } else {
        const count = result.h1Count ?? 0;
        if (count === 1) { h1Score = 15; h1Reason = 'Single H1 — perfect'; }
        else if (count > 1) { h1Score = 7; h1Reason = `${count} H1 tags — use only one`; }
    }

    // ── Content depth (15 pts) ──────────────────────────────────
    let contentScore = 0;
    let contentReason = 'No content detected';
    if (blocked) {
        contentScore = 8;
        contentReason = 'Page not accessible';
    } else {
        const words = result.wordCount ?? 0;
        if (words >= 300) { contentScore = 15; contentReason = `${words} words — good depth`; }
        else if (words >= 150) { contentScore = 8; contentReason = `${words} words — add more (target 300+)`; }
        else if (words > 0) { contentScore = 3; contentReason = `${words} words — thin content (target 300+)`; }
    }

    // ── Canonicals (10 pts) ─────────────────────────────────────
    let canonScore = 0;
    let canonReason = 'No canonical data';
    if (blocked) {
        canonScore = 5;
        canonReason = 'Page not accessible';
    } else {
        const issues = result.canonicalIssues?.length ?? 0;
        if (issues === 0) { canonScore = 10; canonReason = 'No canonical issues'; }
        else if (issues === 1) { canonScore = 5; canonReason = `1 issue: ${result.canonicalIssues![0].replace(/-/g, ' ')}`; }
        else { canonScore = 0; canonReason = `${issues} canonical issues found`; }
    }

    // ── Page speed — PSI desktop (15 pts) ───────────────────────
    let speedScore = 8;
    let speedReason = 'No PageSpeed data (neutral)';
    const psi = result.psi_data?.desktop?.score;
    if (typeof psi === 'number') {
        if (psi >= 90) { speedScore = 15; speedReason = `PSI desktop ${psi} — excellent`; }
        else if (psi >= 70) { speedScore = 10; speedReason = `PSI desktop ${psi} — good`; }
        else if (psi >= 50) { speedScore = 5; speedReason = `PSI desktop ${psi} — needs improvement`; }
        else { speedScore = 1; speedReason = `PSI desktop ${psi} — poor`; }
    }

    // ── Indexation (10 pts) ─────────────────────────────────────
    let indexScore = 0;
    let indexReason = 'Not indexed';
    if (result.status === 'PASS') {
        indexScore = 10;
        indexReason = result.coverageState || 'Indexed';
    } else if (!blocked) {
        indexScore = 5;
        indexReason = result.coverageState || 'Crawled, not indexed';
    }

    let total = titleScore + descScore + h1Score + contentScore + canonScore + speedScore + indexScore;

    // Hard caps for broken / blocked pages
    if (httpError) total = Math.min(total, 20);
    else if (result.contentBlocked) total = Math.min(total, 30);

    total = Math.round(Math.min(100, Math.max(0, total)));

    return {
        total,
        label: total >= 80 ? 'Excellent' : total >= 60 ? 'Good' : total >= 40 ? 'Needs Work' : 'Poor',
        title: { score: titleScore, max: 20, reason: titleReason },
        description: { score: descScore, max: 15, reason: descReason },
        h1: { score: h1Score, max: 15, reason: h1Reason },
        content: { score: contentScore, max: 15, reason: contentReason },
        canonical: { score: canonScore, max: 10, reason: canonReason },
        speed: { score: speedScore, max: 15, reason: speedReason },
        indexation: { score: indexScore, max: 10, reason: indexReason },
    };
}

export function getSeoScoreBadgeClass(score: number) {
    if (score >= 80) return 'bg-emerald-300 text-black';
    if (score >= 60) return 'bg-yellow-300 text-black';
    if (score >= 40) return 'bg-amber-400 text-black';
    return 'bg-red-500 text-white';
}

export function getSeoScoreBarClass(score: number) {
    if (score >= 80) return 'bg-emerald-400';
    if (score >= 60) return 'bg-yellow-400';
    if (score >= 40) return 'bg-amber-400';
    return 'bg-red-500';
}
