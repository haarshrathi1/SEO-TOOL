import type { AuditResult } from './types';

export type CanonicalFlag =
    | 'redirected-url'
    | 'redirect-chain'
    | 'missing-canonical'
    | 'multiple-canonicals'
    | 'canonical-mismatch'
    | 'cross-domain-canonical'
    | 'canonical-target-redirects'
    | 'canonical-loop';

interface CanonicalFlagMeta {
    label: string;
    description: string;
    tone: 'critical' | 'warning' | 'info';
}

export interface CanonicalMetric {
    label: string;
    value: number;
    detail: string;
}

export interface CanonicalIssueCard {
    flag: CanonicalFlag;
    label: string;
    count: number;
    description: string;
    tone: 'critical' | 'warning' | 'info';
    sampleUrls: string[];
}

export interface CanonicalAuditModel {
    metrics: CanonicalMetric[];
    cards: CanonicalIssueCard[];
    healthySelfCanonicalCount: number;
    hasCanonicalData: boolean;
}

export const CANONICAL_FLAG_META: Record<CanonicalFlag, CanonicalFlagMeta> = {
    'redirected-url': {
        label: 'Redirecting sitemap URLs',
        description: 'Sitemap entries should usually land directly, not bounce through redirects.',
        tone: 'warning',
    },
    'redirect-chain': {
        label: 'Redirect chains',
        description: 'Multiple-hop redirects slow crawling and weaken canonical clarity.',
        tone: 'critical',
    },
    'missing-canonical': {
        label: 'Missing canonicals',
        description: 'Pages are missing a canonical tag, which weakens duplicate consolidation.',
        tone: 'warning',
    },
    'multiple-canonicals': {
        label: 'Multiple canonicals',
        description: 'More than one canonical tag was found on the page.',
        tone: 'critical',
    },
    'canonical-mismatch': {
        label: 'Canonical points away',
        description: 'The canonical does not match the final crawled URL.',
        tone: 'warning',
    },
    'cross-domain-canonical': {
        label: 'Cross-domain canonicals',
        description: 'Pages canonicalize to another host, which can remove them from your site\'s indexable set.',
        tone: 'critical',
    },
    'canonical-target-redirects': {
        label: 'Canonical target redirects',
        description: 'Canonical targets should resolve directly, not redirect.',
        tone: 'critical',
    },
    'canonical-loop': {
        label: 'Canonical loops',
        description: 'Two or more pages canonicalize in a cycle, which sends mixed consolidation signals.',
        tone: 'critical',
    },
};

export function hasCanonicalFlag(result: AuditResult, flag: CanonicalFlag) {
    return Boolean(result.canonicalIssues?.includes(flag));
}

export function hasCriticalCanonicalIssue(result: AuditResult) {
    return [
        'redirect-chain',
        'multiple-canonicals',
        'cross-domain-canonical',
        'canonical-target-redirects',
        'canonical-loop',
    ].some((flag) => hasCanonicalFlag(result, flag as CanonicalFlag));
}

export function hasWarningCanonicalIssue(result: AuditResult) {
    return [
        'redirected-url',
        'missing-canonical',
        'canonical-mismatch',
    ].some((flag) => hasCanonicalFlag(result, flag as CanonicalFlag));
}

export function hasCanonicalData(results: AuditResult[]) {
    return results.some((result) =>
        typeof result.redirected === 'boolean'
        || typeof result.finalUrl === 'string'
        || typeof result.canonicalUrl === 'string'
        || Array.isArray(result.canonicalIssues)
    );
}

export function getCanonicalFlagLabel(flag: CanonicalFlag) {
    return CANONICAL_FLAG_META[flag].label;
}

export function getCanonicalBadges(result: AuditResult) {
    const badges: Array<{ label: string; tone: 'critical' | 'warning' | 'info' | 'positive' }> = [];

    (result.canonicalIssues || []).forEach((flag) => {
        if (flag in CANONICAL_FLAG_META) {
            badges.push({
                label: CANONICAL_FLAG_META[flag as CanonicalFlag].label,
                tone: CANONICAL_FLAG_META[flag as CanonicalFlag].tone,
            });
        }
    });

    if (badges.length === 0 && result.canonicalUrl && result.canonicalCount === 1 && !result.redirected) {
        badges.push({ label: 'Self canonical', tone: 'positive' });
    }

    return badges;
}

function sampleUrls(results: AuditResult[], max = 4) {
    return results.slice(0, max).map((result) => result.url);
}

export function buildCanonicalAuditModel(results: AuditResult[]): CanonicalAuditModel {
    const healthySelfCanonicalCount = results.filter((result) =>
        Boolean(result.canonicalUrl)
        && result.canonicalCount === 1
        && !result.redirected
        && (result.canonicalIssues || []).length === 0
    ).length;

    const cards = (Object.entries(CANONICAL_FLAG_META) as Array<[CanonicalFlag, CanonicalFlagMeta]>)
        .map(([flag, meta]) => {
            const affected = results.filter((result) => hasCanonicalFlag(result, flag));
            return {
                flag,
                label: meta.label,
                count: affected.length,
                description: meta.description,
                tone: meta.tone,
                sampleUrls: sampleUrls(affected),
            };
        });

    const highRiskCount = cards
        .filter((card) => card.tone === 'critical')
        .reduce((sum, card) => sum + card.count, 0);

    return {
        metrics: [
            {
                label: 'Healthy self canonicals',
                value: healthySelfCanonicalCount,
                detail: 'Single canonical, no redirects, no canonical warnings',
            },
            {
                label: 'Redirecting URLs',
                value: cards.find((card) => card.flag === 'redirected-url')?.count || 0,
                detail: 'Sitemap URLs that do not resolve directly',
            },
            {
                label: 'Canonical mismatches',
                value: cards.find((card) => card.flag === 'canonical-mismatch')?.count || 0,
                detail: 'Canonical differs from the final crawled URL',
            },
            {
                label: 'High-risk canonical issues',
                value: highRiskCount,
                detail: 'Critical canonical or redirect faults across the audited set',
            },
        ],
        cards,
        healthySelfCanonicalCount,
        hasCanonicalData: hasCanonicalData(results),
    };
}
