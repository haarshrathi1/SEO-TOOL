import { hasCriticalCanonicalIssue, hasWarningCanonicalIssue } from './canonicalAudit';
import { hasLinkingGapWarning } from './internalLinkRecommendations';
import { hasStructuredDataError, hasStructuredDataWarning } from './structuredDataAudit';
import type { AuditResult } from './types';

export const TEMPLATE_FILTER_PREFIX = 'template:';

type TemplateIssueTone = 'critical' | 'warning' | 'info';

interface TemplateIssueFlag {
    id: string;
    label: string;
    tone: TemplateIssueTone;
}

interface PathProfile {
    result: AuditResult;
    urlKey: string;
    segments: string[];
    depth: number;
}

export interface TemplateMetric {
    label: string;
    value: number;
    detail: string;
}

export interface TemplateIssueSummary {
    id: string;
    label: string;
    count: number;
    templateCount: number;
    tone: TemplateIssueTone;
}

export interface TemplateCluster {
    id: string;
    pattern: string;
    pageCount: number;
    indexedPages: number;
    indexedRate: number;
    issuePages: number;
    affectedRate: number;
    score: number;
    issueBreakdown: TemplateIssueSummary[];
    sampleUrls: string[];
}

export interface HealthyTemplateCluster {
    id: string;
    pattern: string;
    pageCount: number;
    indexedRate: number;
    sampleUrls: string[];
}

export interface TemplateClusterModel {
    hasClusters: boolean;
    metrics: TemplateMetric[];
    clusters: TemplateCluster[];
    issueLeaders: TemplateIssueSummary[];
    healthyTemplates: HealthyTemplateCluster[];
}

const TONE_ORDER: Record<TemplateIssueTone, number> = {
    critical: 0,
    warning: 1,
    info: 2,
};

function normalizeUrlKey(value: string) {
    if (!value) return '';

    try {
        const parsed = new URL(value);
        parsed.hash = '';
        parsed.protocol = parsed.protocol.toLowerCase();
        parsed.hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${parsed.protocol}//${parsed.host}${pathname}${parsed.search}`;
    } catch {
        return value.trim().replace(/\/+$/, '') || value.trim();
    }
}

export function getTemplateLookupKey(url: string) {
    return normalizeUrlKey(url);
}

function getPathSegments(url: string) {
    try {
        return new URL(url).pathname
            .split('/')
            .map((segment) => segment.trim().toLowerCase())
            .filter(Boolean);
    } catch {
        return url
            .split('/')
            .map((segment) => segment.trim().toLowerCase())
            .filter(Boolean);
    }
}

function buildProfile(result: AuditResult): PathProfile {
    const segments = getPathSegments(result.url);

    return {
        result,
        urlKey: normalizeUrlKey(result.url),
        segments,
        depth: segments.length,
    };
}

function getBaseGroupKey(profile: PathProfile) {
    return `${profile.segments[0] || '__root__'}::${profile.depth}`;
}

function splitProfiles(profiles: PathProfile[]): PathProfile[][] {
    if (profiles.length < 2) {
        return [profiles];
    }

    const depth = profiles[0]?.depth || 0;

    for (let position = 1; position < depth; position += 1) {
        const buckets = new Map<string, PathProfile[]>();

        profiles.forEach((profile) => {
            const value = profile.segments[position] || '__missing__';
            const bucket = buckets.get(value) || [];
            bucket.push(profile);
            buckets.set(value, bucket);
        });

        const repeatedBuckets = [...buckets.values()].filter((bucket) => bucket.length >= 2);
        const coveredCount = repeatedBuckets.reduce((sum, bucket) => sum + bucket.length, 0);

        if (repeatedBuckets.length >= 2 && coveredCount === profiles.length) {
            return repeatedBuckets.flatMap((bucket) => splitProfiles(bucket));
        }
    }

    return [profiles];
}

function placeholderForPosition(values: string[], position: number, depth: number) {
    if (values.every((value) => /^\d{4}$/.test(value))) {
        return ':year';
    }

    if (values.every((value) => /^\d+$/.test(value))) {
        return ':id';
    }

    if (position === depth - 1) {
        return ':slug';
    }

    if (position === 1) {
        return ':section';
    }

    return '*';
}

function derivePattern(profiles: PathProfile[]) {
    const depth = profiles[0]?.depth || 0;
    if (depth === 0) return '/';

    const patternSegments = [];

    for (let position = 0; position < depth; position += 1) {
        const values = [...new Set(profiles.map((profile) => profile.segments[position] || ''))];
        patternSegments.push(values.length === 1 ? values[0] : placeholderForPosition(values, position, depth));
    }

    return `/${patternSegments.join('/')}`;
}

function toTemplateFilterId(pattern: string) {
    return `${TEMPLATE_FILTER_PREFIX}${pattern}`;
}

function buildTemplateAssignments(results: AuditResult[]) {
    const profiles = results.map((result) => buildProfile(result));
    const grouped = new Map<string, PathProfile[]>();

    profiles.forEach((profile) => {
        if (profile.depth === 0) {
            return;
        }

        const key = getBaseGroupKey(profile);
        const bucket = grouped.get(key) || [];
        bucket.push(profile);
        grouped.set(key, bucket);
    });

    const merged = new Map<string, Map<string, PathProfile>>();

    grouped.forEach((bucket) => {
        if (bucket.length < 2) {
            return;
        }

        splitProfiles(bucket)
            .filter((group) => group.length >= 2)
            .forEach((group) => {
                const pattern = derivePattern(group);
                const patternBucket = merged.get(pattern) || new Map<string, PathProfile>();

                group.forEach((profile) => {
                    patternBucket.set(profile.urlKey, profile);
                });

                merged.set(pattern, patternBucket);
            });
    });

    return [...merged.entries()].map(([pattern, bucket]) => ({
        pattern,
        profiles: [...bucket.values()],
    }));
}

function getTemplateIssueFlags(result: AuditResult): TemplateIssueFlag[] {
    const issues: TemplateIssueFlag[] = [];

    if (result.status !== 'PASS') {
        issues.push({ id: 'not-indexed', label: 'Not indexed', tone: 'critical' });
    }

    if (result.h1Count === 0) {
        issues.push({ id: 'missing-h1', label: 'Missing H1', tone: 'critical' });
    } else if ((result.h1Count || 0) > 1) {
        issues.push({ id: 'multiple-h1', label: 'Multiple H1s', tone: 'warning' });
    }

    if (!result.description) {
        issues.push({ id: 'missing-description', label: 'Missing descriptions', tone: 'warning' });
    }

    if ((result.wordCount || 0) < 300) {
        issues.push({ id: 'thin-content', label: 'Thin content', tone: 'info' });
    }

    if (hasCriticalCanonicalIssue(result)) {
        issues.push({ id: 'canonical-errors', label: 'Canonical errors', tone: 'critical' });
    } else if (hasWarningCanonicalIssue(result)) {
        issues.push({ id: 'canonical-warnings', label: 'Canonical warnings', tone: 'warning' });
    }

    if (hasStructuredDataError(result)) {
        issues.push({ id: 'schema-errors', label: 'Schema errors', tone: 'warning' });
    } else if (hasStructuredDataWarning(result)) {
        issues.push({ id: 'schema-warnings', label: 'Schema warnings', tone: 'info' });
    }

    if (hasLinkingGapWarning(result)) {
        issues.push({ id: 'link-gaps', label: 'Link gaps', tone: 'warning' });
    }

    if (typeof result.psi_data?.desktop?.score === 'number' && result.psi_data.desktop.score < 50) {
        issues.push({ id: 'slow-desktop-psi', label: 'Slow desktop PSI', tone: 'warning' });
    }

    return issues;
}

function sortIssueSummaries(left: TemplateIssueSummary, right: TemplateIssueSummary) {
    return right.count - left.count
        || TONE_ORDER[left.tone] - TONE_ORDER[right.tone]
        || left.label.localeCompare(right.label);
}

function buildCluster(pattern: string, profiles: PathProfile[]): TemplateCluster {
    const issueCounts = new Map<string, TemplateIssueSummary>();
    let issuePages = 0;
    let criticalHits = 0;
    let warningHits = 0;

    profiles.forEach((profile) => {
        const flags = getTemplateIssueFlags(profile.result);
        if (flags.length > 0) {
            issuePages += 1;
        }

        flags.forEach((flag) => {
            if (flag.tone === 'critical') criticalHits += 1;
            if (flag.tone === 'warning') warningHits += 1;

            const current = issueCounts.get(flag.id);
            if (current) {
                current.count += 1;
            } else {
                issueCounts.set(flag.id, {
                    id: flag.id,
                    label: flag.label,
                    count: 1,
                    templateCount: 1,
                    tone: flag.tone,
                });
            }
        });
    });

    const pageCount = profiles.length;
    const indexedPages = profiles.filter((profile) => profile.result.status === 'PASS').length;
    const indexedRate = Math.round((indexedPages / pageCount) * 100);
    const affectedRate = Math.round((issuePages / pageCount) * 100);
    const issueBreakdown = [...issueCounts.values()].sort(sortIssueSummaries).slice(0, 5);
    const score = (affectedRate * 2) + (criticalHits * 4) + (warningHits * 2) + Math.min(pageCount, 20);

    return {
        id: toTemplateFilterId(pattern),
        pattern,
        pageCount,
        indexedPages,
        indexedRate,
        issuePages,
        affectedRate,
        score,
        issueBreakdown,
        sampleUrls: profiles.slice(0, 4).map((profile) => profile.result.url),
    };
}

function buildAllClusters(results: AuditResult[]) {
    return buildTemplateAssignments(results)
        .map(({ pattern, profiles }) => buildCluster(pattern, profiles))
        .sort((left, right) =>
            right.score - left.score
            || right.pageCount - left.pageCount
            || left.pattern.localeCompare(right.pattern)
        );
}

export function buildTemplateClusterLookup(results: AuditResult[]) {
    const lookup = new Map<string, string>();

    buildTemplateAssignments(results).forEach(({ pattern, profiles }) => {
        profiles.forEach((profile) => {
            lookup.set(profile.urlKey, pattern);
        });
    });

    return lookup;
}

export function isTemplateFilterId(filterId: string) {
    return filterId.startsWith(TEMPLATE_FILTER_PREFIX);
}

export function getTemplatePatternFromFilterId(filterId: string) {
    return isTemplateFilterId(filterId) ? filterId.slice(TEMPLATE_FILTER_PREFIX.length) : '';
}

export function filterResultsByTemplateFilter(results: AuditResult[], filterId: string) {
    const targetPattern = getTemplatePatternFromFilterId(filterId);
    if (!targetPattern) {
        return results;
    }

    const lookup = buildTemplateClusterLookup(results);
    return results.filter((result) => lookup.get(normalizeUrlKey(result.url)) === targetPattern);
}

export function buildTemplateClusterModel(results: AuditResult[]): TemplateClusterModel {
    const allClusters = buildAllClusters(results);
    const flaggedClusters = allClusters.filter((cluster) => cluster.issuePages > 0);
    const healthyTemplates = allClusters
        .filter((cluster) => cluster.issuePages === 0)
        .slice(0, 5)
        .map((cluster) => ({
            id: cluster.id,
            pattern: cluster.pattern,
            pageCount: cluster.pageCount,
            indexedRate: cluster.indexedRate,
            sampleUrls: cluster.sampleUrls,
        }));

    const issueLeadersMap = new Map<string, TemplateIssueSummary>();
    flaggedClusters.forEach((cluster) => {
        cluster.issueBreakdown.forEach((issue) => {
            const current = issueLeadersMap.get(issue.id);
            if (current) {
                current.count += issue.count;
                current.templateCount += 1;
            } else {
                issueLeadersMap.set(issue.id, { ...issue });
            }
        });
    });

    const issueLeaders = [...issueLeadersMap.values()]
        .sort((left, right) =>
            right.templateCount - left.templateCount
            || sortIssueSummaries(left, right)
        )
        .slice(0, 8);

    const largestCluster = allClusters[0];

    return {
        hasClusters: allClusters.length > 0,
        metrics: [
            {
                label: 'Flagged templates',
                value: flaggedClusters.length,
                detail: 'Multi-page URL patterns with repeated SEO issues',
            },
            {
                label: 'Clustered pages',
                value: allClusters.reduce((sum, cluster) => sum + cluster.pageCount, 0),
                detail: 'Pages grouped into repeatable URL-pattern families',
            },
            {
                label: 'Repeated issue types',
                value: issueLeaders.length,
                detail: 'Issue categories repeating across clustered templates',
            },
            {
                label: 'Largest template',
                value: largestCluster?.pageCount || 0,
                detail: largestCluster ? largestCluster.pattern : 'No multi-page template cluster',
            },
        ],
        clusters: flaggedClusters,
        issueLeaders,
        healthyTemplates,
    };
}
