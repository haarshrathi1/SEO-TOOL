import { hasCriticalCanonicalIssue } from './canonicalAudit';
import type { AuditResult } from './types';

export type InternalLinkFilterId =
    | 'links-opportunities'
    | 'links-indexed-orphans'
    | 'links-high-value-underlinked'
    | 'links-source-hubs';

interface InternalLinkCardMeta {
    title: string;
    description: string;
    tone: 'critical' | 'warning' | 'positive' | 'info';
}

export interface InternalLinkMetric {
    label: string;
    value: number;
    detail: string;
}

export interface InternalLinkCard {
    id: InternalLinkFilterId;
    title: string;
    description: string;
    tone: 'critical' | 'warning' | 'positive' | 'info';
    count: number;
    sampleUrls: string[];
}

export interface InternalLinkSourceSuggestion {
    url: string;
    score: number;
    reasons: string[];
    views: number;
    incomingLinks: number;
}

export interface InternalLinkOpportunity {
    targetUrl: string;
    targetTitle: string;
    priority: number;
    reasons: string[];
    incomingLinks: number;
    views: number;
    status: string;
    sources: InternalLinkSourceSuggestion[];
}

export interface InternalLinkSourceHub {
    url: string;
    score: number;
    reasons: string[];
    views: number;
    incomingLinks: number;
    internalLinksOut: number;
}

interface InternalLinkSectionBucket {
    label: string;
    count: number;
}

export interface InternalLinkRecommendationsModel {
    hasData: boolean;
    metrics: InternalLinkMetric[];
    cards: InternalLinkCard[];
    opportunities: InternalLinkOpportunity[];
    sourceHubs: InternalLinkSourceHub[];
    sectionBreakdown: InternalLinkSectionBucket[];
}

interface PageProfile {
    result: AuditResult;
    urlKey: string;
    pathSegments: string[];
    primarySection: string;
    tokenSet: Set<string>;
    linkTargets: Set<string>;
}

const INTERNAL_LINK_FILTER_META: Record<InternalLinkFilterId, InternalLinkCardMeta> = {
    'links-indexed-orphans': {
        title: 'Indexed orphan pages',
        description: 'Indexed pages with zero incoming internal links.',
        tone: 'critical',
    },
    'links-high-value-underlinked': {
        title: 'High-value underlinked pages',
        description: 'Traffic-bearing or substantial pages supported by only one or two internal links.',
        tone: 'warning',
    },
    'links-opportunities': {
        title: 'Ready link opportunities',
        description: 'Pages with at least one recommended source page ready for an internal link.',
        tone: 'positive',
    },
    'links-source-hubs': {
        title: 'Strong source pages',
        description: 'Pages strong enough to distribute internal authority to weaker targets.',
        tone: 'info',
    },
};

const INTERNAL_LINK_FILTER_IDS = Object.keys(INTERNAL_LINK_FILTER_META) as InternalLinkFilterId[];
const STOP_WORDS = new Set([
    'about',
    'after',
    'also',
    'and',
    'are',
    'best',
    'blog',
    'com',
    'for',
    'from',
    'guide',
    'home',
    'how',
    'https',
    'http',
    'index',
    'into',
    'news',
    'our',
    'page',
    'pages',
    'the',
    'this',
    'that',
    'what',
    'when',
    'with',
    'your',
]);

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

function getPrimarySection(pathSegments: string[]) {
    return pathSegments[0] ? `/${pathSegments[0]}` : '/';
}

function tokenize(value: string | undefined) {
    return String(value || '')
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !STOP_WORDS.has(token));
}

function getTrafficScore(views: number | undefined) {
    if (!views) return 0;
    if (views >= 1000) return 18;
    if (views >= 250) return 14;
    if (views >= 50) return 10;
    if (views >= 10) return 7;
    return 4;
}

function isHubPath(pathSegments: string[]) {
    return pathSegments.length <= 1;
}

function buildPageProfile(result: AuditResult): PageProfile {
    const pathSegments = getPathSegments(result.url);
    const pathTokens = pathSegments.flatMap((segment) => tokenize(segment.replace(/[-_]+/g, ' ')));
    const titleTokens = tokenize(result.title);
    const tokenSet = new Set([...pathTokens, ...titleTokens]);

    return {
        result,
        urlKey: normalizeUrlKey(result.url),
        pathSegments,
        primarySection: getPrimarySection(pathSegments),
        tokenSet,
        linkTargets: new Set((result.internalLinks || []).map((url) => normalizeUrlKey(url)).filter(Boolean)),
    };
}

function sampleUrls(results: AuditResult[], max = 4) {
    return results.slice(0, max).map((result) => result.url);
}

function sampleHubUrls(hubs: InternalLinkSourceHub[], max = 4) {
    return hubs.slice(0, max).map((hub) => hub.url);
}

function getTargetPriority(result: AuditResult) {
    const incomingLinks = result.incomingLinks || 0;
    let score = 0;

    if (incomingLinks === 0) score += 40;
    else if (incomingLinks === 1) score += 28;
    else if (incomingLinks === 2) score += 18;

    if (result.status === 'PASS') score += 16;
    else if (result.status === 'PARTIAL') score += 8;

    score += getTrafficScore(result.ga4_views);

    if ((result.wordCount || 0) >= 1000) score += 12;
    else if ((result.wordCount || 0) >= 600) score += 8;
    else if ((result.wordCount || 0) >= 300) score += 4;

    if (/dormant/i.test(result.coverageState || '')) {
        score -= 4;
    }

    if (!result.title) {
        score -= 3;
    }

    return Math.max(0, score);
}

function isStableLinkTarget(result: AuditResult) {
    if (result.redirected || hasCriticalCanonicalIssue(result)) {
        return false;
    }

    return result.status === 'PASS' || result.status === 'PARTIAL';
}

function canActAsLinkSource(profile: PageProfile) {
    const result = profile.result;

    if (result.status !== 'PASS' || result.redirected || hasCriticalCanonicalIssue(result)) {
        return false;
    }

    return (
        (result.wordCount || 0) >= 250
        || (result.ga4_views || 0) > 0
        || (result.incomingLinks || 0) >= 2
        || isHubPath(profile.pathSegments)
    );
}

function getSourceHubScore(profile: PageProfile) {
    if (!canActAsLinkSource(profile)) {
        return 0;
    }

    let score = 8;
    score += getTrafficScore(profile.result.ga4_views);
    score += Math.min(18, (profile.result.incomingLinks || 0) * 2);
    score += Math.min(12, Math.max(0, (profile.result.internalLinksOut || 0) - 1));

    if (isHubPath(profile.pathSegments)) {
        score += 10;
    }

    if ((profile.result.wordCount || 0) >= 600) {
        score += 4;
    }

    return score;
}

function isSourceHub(profile: PageProfile) {
    return getSourceHubScore(profile) >= 26;
}

function getSourceHubReasons(profile: PageProfile) {
    const reasons: string[] = [];

    if (isHubPath(profile.pathSegments)) reasons.push('Hub page');
    if ((profile.result.ga4_views || 0) >= 50) reasons.push('Traffic source');
    else if ((profile.result.ga4_views || 0) > 0) reasons.push('Some traffic');
    if ((profile.result.incomingLinks || 0) >= 5) reasons.push('Strong authority');
    else if ((profile.result.incomingLinks || 0) >= 3) reasons.push('Internal authority');
    if ((profile.result.internalLinksOut || 0) >= 8) reasons.push('Already links across site');
    if ((profile.result.wordCount || 0) >= 600) reasons.push('Rich content page');

    return [...new Set(reasons)].slice(0, 3);
}

export function isIndexedOrphan(result: AuditResult) {
    return isStableLinkTarget(result) && result.status === 'PASS' && (result.incomingLinks || 0) === 0;
}

export function isHighValueUnderlinked(result: AuditResult) {
    const incomingLinks = result.incomingLinks || 0;

    return (
        isStableLinkTarget(result)
        && result.status === 'PASS'
        && incomingLinks > 0
        && incomingLinks <= 2
        && (
            (result.ga4_views || 0) > 0
            || (result.wordCount || 0) >= 600
        )
    );
}

function isOpportunityTarget(result: AuditResult) {
    const incomingLinks = result.incomingLinks || 0;

    return (
        isStableLinkTarget(result)
        && incomingLinks <= 2
        && (
            result.status === 'PASS'
            || (result.ga4_views || 0) > 0
            || (result.wordCount || 0) >= 600
        )
    );
}

function getTargetReasons(result: AuditResult) {
    const reasons: string[] = [];
    const incomingLinks = result.incomingLinks || 0;

    if (incomingLinks === 0) reasons.push('No internal links');
    else reasons.push(`Only ${incomingLinks} internal link${incomingLinks === 1 ? '' : 's'}`);

    if ((result.ga4_views || 0) > 0) reasons.push('Has traffic');
    if ((result.wordCount || 0) >= 600) reasons.push('Strong content asset');
    if (result.status === 'PASS') reasons.push('Indexed destination');

    return [...new Set(reasons)].slice(0, 4);
}

function countSharedTokens(left: Set<string>, right: Set<string>) {
    let count = 0;
    left.forEach((token) => {
        if (right.has(token)) {
            count += 1;
        }
    });
    return count;
}

function buildSourceSuggestions(target: PageProfile, profiles: PageProfile[]): InternalLinkSourceSuggestion[] {
    const targetSubsection = target.pathSegments[1] || '';

    return profiles
        .map((source) => {
            if (!canActAsLinkSource(source) || source.urlKey === target.urlKey || source.linkTargets.has(target.urlKey)) {
                return null;
            }

            let score = 0;
            const reasons: string[] = [];

            if (target.primarySection !== '/' && source.primarySection === target.primarySection) {
                score += 22;
                reasons.push('Same section');
            }

            if (targetSubsection && source.pathSegments[1] && source.pathSegments[1] === targetSubsection) {
                score += 8;
                reasons.push('Same subsection');
            }

            const sharedTokens = countSharedTokens(source.tokenSet, target.tokenSet);
            if (sharedTokens >= 3) {
                score += 22;
                reasons.push('Strong topic match');
            } else if (sharedTokens === 2) {
                score += 16;
                reasons.push('Topic match');
            } else if (sharedTokens === 1) {
                score += 8;
                reasons.push('Shared term');
            }

            const trafficScore = getTrafficScore(source.result.ga4_views);
            score += trafficScore;
            if (trafficScore >= 10) reasons.push('Existing traffic');
            else if (trafficScore > 0) reasons.push('Some traffic');

            if ((source.result.incomingLinks || 0) >= 6) {
                score += 10;
                reasons.push('Strong authority');
            } else if ((source.result.incomingLinks || 0) >= 3) {
                score += 6;
                reasons.push('Internal authority');
            }

            if (isHubPath(source.pathSegments)) {
                score += 8;
                reasons.push('Hub page');
            }

            if ((source.result.internalLinksOut || 0) > 80) {
                score -= 6;
            }

            if (score < 22) {
                return null;
            }

            return {
                url: source.result.url,
                score,
                reasons: [...new Set(reasons)].slice(0, 3),
                views: source.result.ga4_views || 0,
                incomingLinks: source.result.incomingLinks || 0,
            };
        })
        .filter((item): item is InternalLinkSourceSuggestion => Boolean(item))
        .sort((left, right) =>
            right.score - left.score
            || right.views - left.views
            || right.incomingLinks - left.incomingLinks
            || left.url.localeCompare(right.url)
        )
        .slice(0, 3);
}

function buildDefaultModel(hasData: boolean): InternalLinkRecommendationsModel {
    return {
        hasData,
        metrics: [
            { label: 'Priority targets', value: 0, detail: 'Pages with ready link opportunities' },
            { label: 'Indexed orphans', value: 0, detail: 'Indexed pages with zero internal support' },
            { label: 'Suggested links', value: 0, detail: 'Top recommendation set for this snapshot' },
            { label: 'Source hubs', value: 0, detail: 'Pages strong enough to distribute authority' },
        ],
        cards: INTERNAL_LINK_FILTER_IDS.map((id) => ({
            id,
            title: INTERNAL_LINK_FILTER_META[id].title,
            description: INTERNAL_LINK_FILTER_META[id].description,
            tone: INTERNAL_LINK_FILTER_META[id].tone,
            count: 0,
            sampleUrls: [],
        })),
        opportunities: [],
        sourceHubs: [],
        sectionBreakdown: [],
    };
}

export function isInternalLinkFilterId(filterId: string): filterId is InternalLinkFilterId {
    return INTERNAL_LINK_FILTER_IDS.includes(filterId as InternalLinkFilterId);
}

export function hasLinkingGapWarning(result: AuditResult) {
    return isIndexedOrphan(result) || isHighValueUnderlinked(result);
}

export function getInternalLinkBadges(result: AuditResult) {
    const profile = buildPageProfile(result);

    if (isIndexedOrphan(result)) {
        return [{ label: 'Indexed orphan', tone: 'critical' as const }];
    }

    if (isHighValueUnderlinked(result)) {
        return [{ label: 'Underlinked', tone: 'warning' as const }];
    }

    if (isSourceHub(profile)) {
        return [{ label: 'Source hub', tone: 'positive' as const }];
    }

    return [];
}

export function buildInternalLinkRecommendationsModel(results: AuditResult[]): InternalLinkRecommendationsModel {
    const hasData = results.some((result) => Array.isArray(result.internalLinks));
    if (!hasData) {
        return buildDefaultModel(false);
    }

    const profiles = results.map((result) => buildPageProfile(result));
    const indexedOrphans = profiles.filter((profile) => isIndexedOrphan(profile.result)).map((profile) => profile.result);
    const highValueUnderlinked = profiles.filter((profile) => isHighValueUnderlinked(profile.result)).map((profile) => profile.result);
    const sourceHubCandidates = profiles
        .filter((profile) => isSourceHub(profile))
        .map((profile) => ({
            url: profile.result.url,
            score: getSourceHubScore(profile),
            reasons: getSourceHubReasons(profile),
            views: profile.result.ga4_views || 0,
            incomingLinks: profile.result.incomingLinks || 0,
            internalLinksOut: profile.result.internalLinksOut || 0,
        }))
        .sort((left, right) =>
            right.score - left.score
            || right.views - left.views
            || right.incomingLinks - left.incomingLinks
            || left.url.localeCompare(right.url)
        );

    const opportunities = profiles
        .filter((profile) => isOpportunityTarget(profile.result))
        .map((profile) => {
            const priority = getTargetPriority(profile.result);
            const sources = buildSourceSuggestions(profile, profiles);

            if (priority < 34 || sources.length === 0) {
                return null;
            }

            return {
                targetUrl: profile.result.url,
                targetTitle: profile.result.title || '',
                priority,
                reasons: getTargetReasons(profile.result),
                incomingLinks: profile.result.incomingLinks || 0,
                views: profile.result.ga4_views || 0,
                status: profile.result.status,
                sources,
            };
        })
        .filter((item): item is InternalLinkOpportunity => Boolean(item))
        .sort((left, right) =>
            right.priority - left.priority
            || right.views - left.views
            || left.targetUrl.localeCompare(right.targetUrl)
        );

    const sectionCounts = new Map<string, number>();
    opportunities.forEach((item) => {
        const section = getPrimarySection(getPathSegments(item.targetUrl));
        sectionCounts.set(section, (sectionCounts.get(section) || 0) + 1);
    });

    const totalSuggestedLinks = opportunities.reduce((sum, opportunity) => sum + opportunity.sources.length, 0);
    const cards: InternalLinkCard[] = [
        {
            id: 'links-indexed-orphans',
            title: INTERNAL_LINK_FILTER_META['links-indexed-orphans'].title,
            description: INTERNAL_LINK_FILTER_META['links-indexed-orphans'].description,
            tone: INTERNAL_LINK_FILTER_META['links-indexed-orphans'].tone,
            count: indexedOrphans.length,
            sampleUrls: sampleUrls(indexedOrphans),
        },
        {
            id: 'links-high-value-underlinked',
            title: INTERNAL_LINK_FILTER_META['links-high-value-underlinked'].title,
            description: INTERNAL_LINK_FILTER_META['links-high-value-underlinked'].description,
            tone: INTERNAL_LINK_FILTER_META['links-high-value-underlinked'].tone,
            count: highValueUnderlinked.length,
            sampleUrls: sampleUrls(highValueUnderlinked),
        },
        {
            id: 'links-opportunities',
            title: INTERNAL_LINK_FILTER_META['links-opportunities'].title,
            description: INTERNAL_LINK_FILTER_META['links-opportunities'].description,
            tone: INTERNAL_LINK_FILTER_META['links-opportunities'].tone,
            count: opportunities.length,
            sampleUrls: opportunities.slice(0, 4).map((item) => item.targetUrl),
        },
        {
            id: 'links-source-hubs',
            title: INTERNAL_LINK_FILTER_META['links-source-hubs'].title,
            description: INTERNAL_LINK_FILTER_META['links-source-hubs'].description,
            tone: INTERNAL_LINK_FILTER_META['links-source-hubs'].tone,
            count: sourceHubCandidates.length,
            sampleUrls: sampleHubUrls(sourceHubCandidates),
        },
    ];

    return {
        hasData: true,
        metrics: [
            {
                label: 'Priority targets',
                value: opportunities.length,
                detail: 'Pages with at least one recommended source page',
            },
            {
                label: 'Indexed orphans',
                value: indexedOrphans.length,
                detail: 'Indexed pages with zero incoming internal links',
            },
            {
                label: 'Suggested links',
                value: totalSuggestedLinks,
                detail: 'Top recommendation set across this snapshot',
            },
            {
                label: 'Source hubs',
                value: sourceHubCandidates.length,
                detail: 'Pages strong enough to pass internal authority',
            },
        ],
        cards,
        opportunities,
        sourceHubs: sourceHubCandidates.slice(0, 8),
        sectionBreakdown: [...sectionCounts.entries()]
            .map(([label, count]) => ({
                label: label === '/' ? 'Homepage / root' : label,
                count,
            }))
            .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
            .slice(0, 6),
    };
}

export function filterResultsByInternalLinkFilter(results: AuditResult[], filterId: InternalLinkFilterId) {
    switch (filterId) {
        case 'links-indexed-orphans':
            return results.filter((result) => isIndexedOrphan(result));
        case 'links-high-value-underlinked':
            return results.filter((result) => isHighValueUnderlinked(result));
        case 'links-source-hubs':
            return results.filter((result) => isSourceHub(buildPageProfile(result)));
        case 'links-opportunities': {
            const targetKeys = new Set(buildInternalLinkRecommendationsModel(results).opportunities.map((item) => normalizeUrlKey(item.targetUrl)));
            return results.filter((result) => targetKeys.has(normalizeUrlKey(result.url)));
        }
        default:
            return results;
    }
}
