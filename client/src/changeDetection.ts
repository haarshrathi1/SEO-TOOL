import type { AuditResult } from './types';

export type AuditChangeFilterId =
    | 'new-indexing-loss'
    | 'recovered-indexing'
    | 'new-canonical-issues'
    | 'resolved-canonical-issues'
    | 'new-orphans'
    | 'psi-drop'
    | 'psi-gain'
    | 'title-changed'
    | 'description-changed'
    | 'h1-changed'
    | 'canonical-changed'
    | 'new-urls';

type AuditChangeGroup = 'regressions' | 'fixes' | 'content';

interface AuditChangeMeta {
    title: string;
    description: string;
    tone: 'critical' | 'warning' | 'positive' | 'info';
    group: AuditChangeGroup;
}

export interface AuditChangeCard {
    id: AuditChangeFilterId;
    title: string;
    description: string;
    tone: 'critical' | 'warning' | 'positive' | 'info';
    group: AuditChangeGroup;
    count: number;
    sampleUrls: string[];
}

export interface AuditChangeSection {
    id: AuditChangeGroup;
    title: string;
    description: string;
    cards: AuditChangeCard[];
}

export interface AuditChangeModel {
    summary: {
        changedUrls: number;
        regressions: number;
        fixes: number;
        contentChanges: number;
        newUrls: number;
        removedUrls: number;
    };
    sections: AuditChangeSection[];
    newUrlSamples: string[];
    removedUrlSamples: string[];
}

const AUDIT_CHANGE_META: Record<AuditChangeFilterId, AuditChangeMeta> = {
    'new-indexing-loss': {
        title: 'New indexing losses',
        description: 'Pages that were indexed before and are now excluded or failing.',
        tone: 'critical',
        group: 'regressions',
    },
    'new-canonical-issues': {
        title: 'New canonical issues',
        description: 'Pages that picked up new canonical or redirect faults since the previous snapshot.',
        tone: 'critical',
        group: 'regressions',
    },
    'new-orphans': {
        title: 'New orphan pages',
        description: 'Pages that lost their internal support and now have zero incoming internal links.',
        tone: 'warning',
        group: 'regressions',
    },
    'psi-drop': {
        title: 'Desktop PSI drops',
        description: 'Pages whose desktop PSI score dropped by at least 10 points.',
        tone: 'warning',
        group: 'regressions',
    },
    'recovered-indexing': {
        title: 'Recovered indexing',
        description: 'Pages that were previously not indexed and are now back in Google.',
        tone: 'positive',
        group: 'fixes',
    },
    'resolved-canonical-issues': {
        title: 'Resolved canonical issues',
        description: 'Pages that shed canonical or redirect issues compared with the previous snapshot.',
        tone: 'positive',
        group: 'fixes',
    },
    'psi-gain': {
        title: 'Desktop PSI gains',
        description: 'Pages whose desktop PSI score improved by at least 10 points.',
        tone: 'positive',
        group: 'fixes',
    },
    'title-changed': {
        title: 'Title changes',
        description: 'Pages whose title tag changed since the previous crawl.',
        tone: 'info',
        group: 'content',
    },
    'description-changed': {
        title: 'Meta description changes',
        description: 'Pages whose meta description changed between snapshots.',
        tone: 'info',
        group: 'content',
    },
    'h1-changed': {
        title: 'H1 changes',
        description: 'Pages whose H1 count shifted, often pointing to template or content changes.',
        tone: 'info',
        group: 'content',
    },
    'canonical-changed': {
        title: 'Canonical target changes',
        description: 'Pages whose canonical target changed, which can alter consolidation behavior.',
        tone: 'info',
        group: 'content',
    },
    'new-urls': {
        title: 'Newly discovered URLs',
        description: 'Pages appearing in the current audit set that were not present in the previous one.',
        tone: 'info',
        group: 'content',
    },
};

const AUDIT_CHANGE_FILTER_IDS = Object.keys(AUDIT_CHANGE_META) as AuditChangeFilterId[];

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

function normalizeText(value: string | undefined) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function getDesktopPsi(result: AuditResult) {
    return typeof result.psi_data?.desktop?.score === 'number' ? result.psi_data.desktop.score : null;
}

function buildResultIndex(results: AuditResult[]) {
    const map = new Map<string, AuditResult>();

    results.forEach((result) => {
        const key = normalizeUrlKey(result.url);
        if (key && !map.has(key)) {
            map.set(key, result);
        }
    });

    return map;
}

function toIssueSet(result: AuditResult | undefined) {
    return new Set(result?.canonicalIssues || []);
}

function hasAddedIssues(current: AuditResult, previous: AuditResult) {
    const currentIssues = toIssueSet(current);
    const previousIssues = toIssueSet(previous);
    return [...currentIssues].some((issue) => !previousIssues.has(issue));
}

function hasResolvedIssues(current: AuditResult, previous: AuditResult) {
    const currentIssues = toIssueSet(current);
    const previousIssues = toIssueSet(previous);
    return [...previousIssues].some((issue) => !currentIssues.has(issue));
}

function sampleUrls(results: AuditResult[], max = 4) {
    return results.slice(0, max).map((result) => result.url);
}

function matchesChangeFilter(current: AuditResult, previous: AuditResult | undefined, filterId: AuditChangeFilterId) {
    if (filterId === 'new-urls') {
        return !previous;
    }

    if (!previous) {
        return false;
    }

    switch (filterId) {
        case 'new-indexing-loss':
            return previous.status === 'PASS' && current.status !== 'PASS';
        case 'recovered-indexing':
            return previous.status !== 'PASS' && current.status === 'PASS';
        case 'new-canonical-issues':
            return hasAddedIssues(current, previous);
        case 'resolved-canonical-issues':
            return hasResolvedIssues(current, previous);
        case 'new-orphans':
            return (previous.incomingLinks || 0) > 0 && (current.incomingLinks || 0) === 0;
        case 'psi-drop': {
            const currentPsi = getDesktopPsi(current);
            const previousPsi = getDesktopPsi(previous);
            return currentPsi !== null && previousPsi !== null && currentPsi <= previousPsi - 10;
        }
        case 'psi-gain': {
            const currentPsi = getDesktopPsi(current);
            const previousPsi = getDesktopPsi(previous);
            return currentPsi !== null && previousPsi !== null && currentPsi >= previousPsi + 10;
        }
        case 'title-changed':
            return normalizeText(current.title) !== normalizeText(previous.title);
        case 'description-changed':
            return normalizeText(current.description) !== normalizeText(previous.description);
        case 'h1-changed':
            return (current.h1Count || 0) !== (previous.h1Count || 0);
        case 'canonical-changed':
            return normalizeUrlKey(current.canonicalUrl || '') !== normalizeUrlKey(previous.canonicalUrl || '');
        default:
            return false;
    }
}

function uniqueUrlCount(results: AuditResult[]) {
    return new Set(results.map((result) => normalizeUrlKey(result.url))).size;
}

export function isAuditChangeFilterId(filterId: string): filterId is AuditChangeFilterId {
    return AUDIT_CHANGE_FILTER_IDS.includes(filterId as AuditChangeFilterId);
}

export function filterResultsByAuditChange(currentResults: AuditResult[], previousResults: AuditResult[], filterId: AuditChangeFilterId) {
    const previousIndex = buildResultIndex(previousResults);
    return currentResults.filter((result) => matchesChangeFilter(result, previousIndex.get(normalizeUrlKey(result.url)), filterId));
}

export function buildAuditChangeModel(currentResults: AuditResult[], previousResults: AuditResult[]): AuditChangeModel {
    const previousIndex = buildResultIndex(previousResults);
    const currentIndex = buildResultIndex(currentResults);
    const bucketMap = new Map<AuditChangeFilterId, AuditResult[]>();

    AUDIT_CHANGE_FILTER_IDS.forEach((filterId) => {
        bucketMap.set(filterId, []);
    });

    currentResults.forEach((result) => {
        const previous = previousIndex.get(normalizeUrlKey(result.url));

        AUDIT_CHANGE_FILTER_IDS.forEach((filterId) => {
            if (matchesChangeFilter(result, previous, filterId)) {
                bucketMap.get(filterId)?.push(result);
            }
        });
    });

    const removedUrlSamples = previousResults
        .filter((result) => !currentIndex.has(normalizeUrlKey(result.url)))
        .map((result) => result.url)
        .slice(0, 8);

    const regressionResults = [
        ...(bucketMap.get('new-indexing-loss') || []),
        ...(bucketMap.get('new-canonical-issues') || []),
        ...(bucketMap.get('new-orphans') || []),
        ...(bucketMap.get('psi-drop') || []),
    ];
    const fixResults = [
        ...(bucketMap.get('recovered-indexing') || []),
        ...(bucketMap.get('resolved-canonical-issues') || []),
        ...(bucketMap.get('psi-gain') || []),
    ];
    const contentResults = [
        ...(bucketMap.get('title-changed') || []),
        ...(bucketMap.get('description-changed') || []),
        ...(bucketMap.get('h1-changed') || []),
        ...(bucketMap.get('canonical-changed') || []),
        ...(bucketMap.get('new-urls') || []),
    ];
    const changedResults = [
        ...regressionResults,
        ...fixResults,
        ...contentResults,
    ];

    const cards = AUDIT_CHANGE_FILTER_IDS.map((filterId) => ({
        id: filterId,
        title: AUDIT_CHANGE_META[filterId].title,
        description: AUDIT_CHANGE_META[filterId].description,
        tone: AUDIT_CHANGE_META[filterId].tone,
        group: AUDIT_CHANGE_META[filterId].group,
        count: bucketMap.get(filterId)?.length || 0,
        sampleUrls: sampleUrls(bucketMap.get(filterId) || []),
    }));

    return {
        summary: {
            changedUrls: uniqueUrlCount(changedResults),
            regressions: uniqueUrlCount(regressionResults),
            fixes: uniqueUrlCount(fixResults),
            contentChanges: uniqueUrlCount(contentResults),
            newUrls: bucketMap.get('new-urls')?.length || 0,
            removedUrls: previousResults.filter((result) => !currentIndex.has(normalizeUrlKey(result.url))).length,
        },
        sections: [
            {
                id: 'regressions',
                title: 'New Regressions',
                description: 'What got worse compared with the previous snapshot.',
                cards: cards.filter((card) => card.group === 'regressions'),
            },
            {
                id: 'fixes',
                title: 'Recovered Signals',
                description: 'What improved or recovered since the previous snapshot.',
                cards: cards.filter((card) => card.group === 'fixes'),
            },
            {
                id: 'content',
                title: 'Content and Template Shifts',
                description: 'What changed in tags, structure, and audit scope.',
                cards: cards.filter((card) => card.group === 'content'),
            },
        ],
        newUrlSamples: (bucketMap.get('new-urls') || []).slice(0, 8).map((result) => result.url),
        removedUrlSamples,
    };
}
