import type { AuditResult } from './types';

export interface IndexationSummary {
    sitemapUrls: number;
    crawledUrls: number;
    indexedUrls: number;
    notIndexedUrls: number;
    internallyLinkedUrls: number;
    internallyDiscoveredUrls: number;
    internalOnlyUrls: number;
}

export interface IndexationCoverageBucket {
    label: string;
    count: number;
}

export interface IndexationGapCard {
    id: string;
    title: string;
    count: number;
    description: string;
    tone: 'critical' | 'warning' | 'info' | 'positive';
    sampleUrls: string[];
    reviewFilterId?: string;
}

export interface IndexationGapModel {
    summary: IndexationSummary;
    cards: IndexationGapCard[];
    coverage: IndexationCoverageBucket[];
    internalOnlySamples: string[];
    hasInternalDiscovery: boolean;
}

function normalizeUrlKey(value: string) {
    if (!value) return '';

    try {
        const parsed = new URL(value);
        parsed.hash = '';
        parsed.hostname = parsed.hostname.toLowerCase();
        const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${parsed.protocol.toLowerCase()}//${parsed.host}${pathname}${parsed.search}`;
    } catch {
        return value.trim().replace(/\/+$/, '');
    }
}

function sampleUrls(results: AuditResult[], max = 4) {
    return results.slice(0, max).map((result) => result.url);
}

function isIndexed(result: AuditResult) {
    return result.status === 'PASS';
}

function buildCoverageBuckets(results: AuditResult[]) {
    const buckets = new Map<string, number>();

    results.forEach((result) => {
        const label = result.coverageState || 'Unknown';
        buckets.set(label, (buckets.get(label) || 0) + 1);
    });

    return [...buckets.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
}

export function buildIndexationGapModel(results: AuditResult[]): IndexationGapModel {
    const auditedUrlMap = new Map<string, string>();
    const discoveredInternalUrlMap = new Map<string, string>();
    let hasInternalDiscovery = false;

    results.forEach((result) => {
        const auditedKey = normalizeUrlKey(result.url);
        if (auditedKey && !auditedUrlMap.has(auditedKey)) {
            auditedUrlMap.set(auditedKey, result.url);
        }

        if (Array.isArray(result.internalLinks)) {
            hasInternalDiscovery = true;
            result.internalLinks.forEach((url) => {
                const key = normalizeUrlKey(url);
                if (key && !discoveredInternalUrlMap.has(key)) {
                    discoveredInternalUrlMap.set(key, url);
                }
            });
        }
    });

    const indexedUrls = results.filter(isIndexed);
    const notIndexedUrls = results.filter((result) => !isIndexed(result));
    const internallyLinkedUrls = results.filter((result) => (result.incomingLinks || 0) > 0);
    const linkedNotIndexed = notIndexedUrls.filter((result) => (result.incomingLinks || 0) > 0);
    const sitemapOrphans = results.filter((result) => (result.incomingLinks || 0) === 0);
    const indexedOrphans = indexedUrls.filter((result) => (result.incomingLinks || 0) === 0);
    const dormantIndexed = indexedUrls.filter((result) => /dormant/i.test(result.coverageState || ''));
    const blockedOrExcluded = notIndexedUrls.filter((result) => /blocked|robots|not found|soft 404|server error|redirect|duplicate|not indexed/i.test([
        result.coverageState,
        result.indexingState,
        result.robotStatus,
    ].join(' ').toLowerCase()));

    const internalOnlyUrls = [...discoveredInternalUrlMap.entries()]
        .filter(([key]) => !auditedUrlMap.has(key))
        .map(([, url]) => url);

    return {
        summary: {
            sitemapUrls: auditedUrlMap.size,
            crawledUrls: results.length,
            indexedUrls: indexedUrls.length,
            notIndexedUrls: notIndexedUrls.length,
            internallyLinkedUrls: internallyLinkedUrls.length,
            internallyDiscoveredUrls: discoveredInternalUrlMap.size,
            internalOnlyUrls: internalOnlyUrls.length,
        },
        cards: [
            {
                id: 'linked-not-indexed',
                title: 'Linked but not indexed',
                count: linkedNotIndexed.length,
                description: 'Internal links exist, but Google still is not indexing these URLs.',
                tone: linkedNotIndexed.length > 0 ? 'critical' : 'positive',
                sampleUrls: sampleUrls(linkedNotIndexed),
                reviewFilterId: 'linked-not-indexed',
            },
            {
                id: 'indexed-orphan',
                title: 'Indexed but unlinked',
                count: indexedOrphans.length,
                description: 'Google can see these pages, but your internal architecture is not supporting them.',
                tone: indexedOrphans.length > 0 ? 'warning' : 'positive',
                sampleUrls: sampleUrls(indexedOrphans),
                reviewFilterId: 'indexed-orphan',
            },
            {
                id: 'sitemap-orphans',
                title: 'Sitemap URLs with no internal links',
                count: sitemapOrphans.length,
                description: 'These URLs are in the audit set, but nothing in the crawl points to them.',
                tone: sitemapOrphans.length > 0 ? 'warning' : 'positive',
                sampleUrls: sampleUrls(sitemapOrphans),
                reviewFilterId: 'sitemap-orphans',
            },
            {
                id: 'dormant-indexed',
                title: 'Indexed but dormant',
                count: dormantIndexed.length,
                description: 'These pages are indexed, but not currently earning impressions in Search Console.',
                tone: dormantIndexed.length > 0 ? 'info' : 'positive',
                sampleUrls: sampleUrls(dormantIndexed),
                reviewFilterId: 'dormant-indexed',
            },
            {
                id: 'blocked-excluded',
                title: 'Blocked or excluded URLs',
                count: blockedOrExcluded.length,
                description: 'Robots, 4xx/5xx, duplicates, or exclusion states are holding these URLs back.',
                tone: blockedOrExcluded.length > 0 ? 'critical' : 'positive',
                sampleUrls: sampleUrls(blockedOrExcluded),
                reviewFilterId: 'blocked-excluded',
            },
        ],
        coverage: buildCoverageBuckets(results),
        internalOnlySamples: internalOnlyUrls.slice(0, 8),
        hasInternalDiscovery,
    };
}
