import { isHighValueUnderlinked, isIndexedOrphan } from './internalLinkRecommendations';
import { hasStructuredDataError, hasStructuredDataWarning } from './structuredDataAudit';
import type { AuditResult, TechnicalAuditIssue } from './types';

export type TechnicalIssueFilterId =
    | 'not-indexed'
    | 'http-errors'
    | 'content-blocked'
    | 'robots-blocked'
    | 'meta-noindex'
    | 'meta-nofollow'
    | 'missing-title'
    | 'short-title'
    | 'long-title'
    | 'duplicate-title'
    | 'missing-desc'
    | 'short-desc'
    | 'long-desc'
    | 'duplicate-desc'
    | 'no-h1'
    | 'multi-h1'
    | 'low-word-count'
    | 'very-thin-content'
    | 'missing-viewport'
    | 'missing-html-lang'
    | 'title-h1-duplicate'
    | 'image-alt-missing'
    | 'image-dimensions-missing'
    | 'open-graph-missing'
    | 'twitter-card-missing'
    | 'hreflang-invalid'
    | 'mixed-content'
    | 'slow-mobile'
    | 'slow-desktop'
    | 'core-web-vitals'
    | 'broken-link'
    | 'indexed-orphan'
    | 'high-value-underlinked'
    | 'schema-errors'
    | 'schema-warnings';

interface TechnicalIssueCard {
    id: TechnicalIssueFilterId;
    title: string;
    description: string;
    severity: TechnicalAuditIssue['severity'];
    count: number;
}

export const TECHNICAL_ISSUE_FILTER_IDS = [
    'not-indexed',
    'http-errors',
    'content-blocked',
    'robots-blocked',
    'meta-noindex',
    'meta-nofollow',
    'missing-title',
    'short-title',
    'long-title',
    'duplicate-title',
    'missing-desc',
    'short-desc',
    'long-desc',
    'duplicate-desc',
    'no-h1',
    'multi-h1',
    'low-word-count',
    'very-thin-content',
    'missing-viewport',
    'missing-html-lang',
    'title-h1-duplicate',
    'image-alt-missing',
    'image-dimensions-missing',
    'open-graph-missing',
    'twitter-card-missing',
    'hreflang-invalid',
    'mixed-content',
    'slow-mobile',
    'slow-desktop',
    'core-web-vitals',
    'broken-link',
    'indexed-orphan',
    'high-value-underlinked',
    'schema-errors',
    'schema-warnings',
] as const satisfies TechnicalIssueFilterId[];

function normalizeText(value: unknown) {
    return String(value || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function countDuplicateField(results: AuditResult[], field: 'title' | 'description') {
    const counts = new Map<string, number>();
    results.forEach((result) => {
        const value = normalizeText(result[field]);
        if (value) counts.set(value, (counts.get(value) || 0) + 1);
    });
    return counts;
}

function pushIssue(issues: TechnicalAuditIssue[], issue: TechnicalAuditIssue) {
    issues.push(issue);
}

function isBlocked(result: AuditResult) {
    return Boolean(result.contentBlocked || (result.httpStatus || 0) >= 400);
}

function isPass(result: AuditResult) {
    return String(result.status || '').toUpperCase() === 'PASS';
}

function collectFallbackIssues(result: AuditResult, titleCounts: Map<string, number>, descriptionCounts: Map<string, number>): TechnicalAuditIssue[] {
    const issues: TechnicalAuditIssue[] = [];
    const blocked = isBlocked(result);
    const httpStatus = result.httpStatus || 0;
    const title = String(result.title || '').trim();
    const description = String(result.description || '').trim();
    const robotsText = [result.coverageState, result.indexingState, result.robotStatus, result.robotsMeta].join(' ');

    if (httpStatus >= 500) {
        pushIssue(issues, { id: 'http-5xx', category: 'crawlability', severity: 'critical', title: 'Server error', details: `HTTP ${httpStatus}` });
    } else if (httpStatus >= 400) {
        pushIssue(issues, { id: 'http-4xx', category: 'crawlability', severity: 'high', title: 'Client error', details: `HTTP ${httpStatus}` });
    } else if (result.contentBlocked) {
        pushIssue(issues, { id: 'content-unreachable', category: 'crawlability', severity: 'high', title: 'Content not reachable', details: result.contentBlockedReason || '' });
    }

    if (!isPass(result)) {
        pushIssue(issues, { id: 'not-indexed', category: 'indexation', severity: 'medium', title: 'Page is not passing index checks', details: result.coverageState || result.status });
    }
    if (/blocked|robots/i.test(robotsText)) {
        pushIssue(issues, { id: 'robots-blocked', category: 'indexation', severity: 'high', title: 'Blocked by robots rules', details: result.robotStatus || result.coverageState || '' });
    }
    if (/noindex/i.test(result.robotsMeta || '')) {
        pushIssue(issues, { id: 'meta-noindex', category: 'indexation', severity: 'high', title: 'Meta noindex detected', details: result.robotsMeta || '' });
    }
    if (/nofollow/i.test(result.robotsMeta || '')) {
        pushIssue(issues, { id: 'meta-nofollow', category: 'indexation', severity: 'medium', title: 'Meta nofollow detected', details: result.robotsMeta || '' });
    }

    if (!blocked) {
        if (!title) {
            pushIssue(issues, { id: 'missing-title', category: 'metadata', severity: 'high', title: 'Missing title tag', details: '' });
        } else {
            if (title.length < 30) pushIssue(issues, { id: 'short-title', category: 'metadata', severity: 'low', title: 'Title is too short', details: `${title.length} characters` });
            if (title.length > 60) pushIssue(issues, { id: 'long-title', category: 'metadata', severity: 'low', title: 'Title is too long', details: `${title.length} characters` });
            if ((titleCounts.get(normalizeText(title)) || 0) > 1) pushIssue(issues, { id: 'duplicate-title', category: 'metadata', severity: 'medium', title: 'Duplicate title', details: title });
        }

        if (!description) {
            pushIssue(issues, { id: 'missing-desc', category: 'metadata', severity: 'medium', title: 'Missing meta description', details: '' });
        } else {
            if (description.length < 70) pushIssue(issues, { id: 'short-desc', category: 'metadata', severity: 'low', title: 'Meta description is too short', details: `${description.length} characters` });
            if (description.length > 160) pushIssue(issues, { id: 'long-desc', category: 'metadata', severity: 'low', title: 'Meta description is too long', details: `${description.length} characters` });
            if ((descriptionCounts.get(normalizeText(description)) || 0) > 1) pushIssue(issues, { id: 'duplicate-desc', category: 'metadata', severity: 'low', title: 'Duplicate meta description', details: description });
        }

        if ((result.h1Count || 0) === 0) pushIssue(issues, { id: 'no-h1', category: 'content', severity: 'high', title: 'Missing H1', details: '' });
        if ((result.h1Count || 0) > 1) pushIssue(issues, { id: 'multi-h1', category: 'content', severity: 'medium', title: 'Multiple H1 headings', details: `${result.h1Count} H1 headings` });
        if ((result.wordCount || 0) > 0 && (result.wordCount || 0) < 50) pushIssue(issues, { id: 'very-thin-content', category: 'content', severity: 'high', title: 'Very thin content', details: `${result.wordCount} words` });
        else if ((result.wordCount || 0) < 300) pushIssue(issues, { id: 'low-word-count', category: 'content', severity: 'medium', title: 'Low word count', details: `${result.wordCount || 0} words` });
        if (!result.viewport) pushIssue(issues, { id: 'missing-viewport', category: 'mobile', severity: 'medium', title: 'Missing viewport tag', details: '' });
        if (!result.htmlLang) pushIssue(issues, { id: 'missing-html-lang', category: 'internationalization', severity: 'low', title: 'Missing HTML language', details: '' });
        if (title && result.h1Text && normalizeText(title) === normalizeText(result.h1Text)) {
            pushIssue(issues, { id: 'title-h1-duplicate', category: 'content', severity: 'low', title: 'Title and H1 are identical', details: result.h1Text });
        }
    }

    const images = Array.isArray(result.images) ? result.images : [];
    const missingAlt = images.filter((image) => !image.hasAlt).length;
    const missingDimensions = images.filter((image) => !image.hasDimensions).length;
    if (missingAlt > 0) pushIssue(issues, { id: 'image-alt-missing', category: 'images', severity: missingAlt >= 5 ? 'medium' : 'low', title: 'Images missing alt text', details: `${missingAlt} images` });
    if (missingDimensions > 0) pushIssue(issues, { id: 'image-dimensions-missing', category: 'images', severity: missingDimensions >= 5 ? 'medium' : 'low', title: 'Images missing dimensions', details: `${missingDimensions} images` });
    if (result.socialMeta) {
        const social = result.socialMeta;
        if (!social.ogTitle || !social.ogDescription || !social.ogImage) pushIssue(issues, { id: 'open-graph-missing', category: 'metadata', severity: 'low', title: 'Open Graph tags incomplete', details: '' });
        if (!social.twitterCard || !social.twitterTitle || !social.twitterDescription || !social.twitterImage) pushIssue(issues, { id: 'twitter-card-missing', category: 'metadata', severity: 'low', title: 'Twitter Card tags incomplete', details: '' });
    }
    if ((result.hreflangs || []).some((entry) => entry.hreflang && entry.hreflang.toLowerCase() !== 'x-default' && !/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(entry.hreflang))) {
        pushIssue(issues, { id: 'hreflang-invalid', category: 'internationalization', severity: 'medium', title: 'Invalid hreflang values', details: '' });
    }
    if ((result.mixedContentUrls || []).length > 0) pushIssue(issues, { id: 'mixed-content', category: 'security', severity: 'high', title: 'Mixed content detected', details: `${result.mixedContentUrls?.length || 0} URLs` });

    (result.canonicalIssues || []).forEach((id) => pushIssue(issues, { id, category: 'canonical', severity: id.includes('loop') || id.includes('cross-domain') || id.includes('multiple') ? 'high' : 'medium', title: id.replace(/-/g, ' '), details: result.canonicalUrl || '' }));
    (result.brokenLinks || []).forEach((link) => pushIssue(issues, { id: 'broken-link', category: 'links', severity: 'high', title: 'Broken link detected', details: link }));
    if (hasStructuredDataError(result)) pushIssue(issues, { id: 'schema-errors', category: 'structured-data', severity: 'high', title: 'Schema errors', details: '' });
    if (!hasStructuredDataError(result) && hasStructuredDataWarning(result)) pushIssue(issues, { id: 'schema-warnings', category: 'structured-data', severity: 'medium', title: 'Schema warnings', details: '' });
    if ((result.psi_data?.mobile?.score || 100) < 90) pushIssue(issues, { id: 'slow-mobile', category: 'performance', severity: (result.psi_data?.mobile?.score || 0) < 50 ? 'high' : 'medium', title: 'Mobile PageSpeed needs work', details: `${result.psi_data?.mobile?.score}` });
    if ((result.psi_data?.desktop?.score || 100) < 90) pushIssue(issues, { id: 'slow-desktop', category: 'performance', severity: (result.psi_data?.desktop?.score || 0) < 50 ? 'high' : 'medium', title: 'Desktop PageSpeed needs work', details: `${result.psi_data?.desktop?.score}` });
    if (isIndexedOrphan(result)) pushIssue(issues, { id: 'indexed-orphan', category: 'links', severity: 'medium', title: 'Indexed orphan page', details: '' });
    if (isHighValueUnderlinked(result)) pushIssue(issues, { id: 'high-value-underlinked', category: 'links', severity: 'low', title: 'High-value page is underlinked', details: '' });

    return issues;
}

export function getTechnicalIssues(result: AuditResult, results: AuditResult[] = []): TechnicalAuditIssue[] {
    if (Array.isArray(result.technicalIssues) && result.technicalIssues.length > 0) {
        return result.technicalIssues;
    }

    return collectFallbackIssues(result, countDuplicateField(results, 'title'), countDuplicateField(results, 'description'));
}

export function isTechnicalIssueFilterId(filterId: string): filterId is TechnicalIssueFilterId {
    return TECHNICAL_ISSUE_FILTER_IDS.includes(filterId as TechnicalIssueFilterId);
}

function matchesIssueId(issue: TechnicalAuditIssue, filterId: TechnicalIssueFilterId) {
    if (filterId === 'http-errors') return issue.id === 'http-4xx' || issue.id === 'http-5xx';
    if (filterId === 'content-blocked') return issue.id === 'content-unreachable' || issue.id === 'http-4xx' || issue.id === 'http-5xx';
    if (filterId === 'core-web-vitals') return /-(lcp|cls|inp)-/.test(issue.id);
    if (filterId === 'low-word-count') return issue.id === 'low-word-count' || issue.id === 'very-thin-content';
    return issue.id === filterId;
}

export function filterResultsByTechnicalIssue(results: AuditResult[], filterId: TechnicalIssueFilterId) {
    return results.filter((result) => getTechnicalIssues(result, results).some((issue) => matchesIssueId(issue, filterId)));
}

function countIssue(results: AuditResult[], filterId: TechnicalIssueFilterId) {
    return filterResultsByTechnicalIssue(results, filterId).length;
}

export function buildTechnicalIssueCards(results: AuditResult[]): TechnicalIssueCard[] {
    const cards: TechnicalIssueCard[] = [
        { id: 'not-indexed', title: 'Pages not indexed', description: 'Excluded, failing, or not serving in Google.', severity: 'high', count: countIssue(results, 'not-indexed') },
        { id: 'http-errors', title: 'HTTP errors', description: '4xx or 5xx responses found during rendered crawl.', severity: 'critical', count: countIssue(results, 'http-errors') },
        { id: 'content-blocked', title: 'Content not reachable', description: 'Blocked, errored, or empty rendered pages.', severity: 'high', count: countIssue(results, 'content-blocked') },
        { id: 'robots-blocked', title: 'Robots blocked pages', description: 'robots.txt, GSC, or rendered robots directives block crawling or indexing.', severity: 'high', count: countIssue(results, 'robots-blocked') },
        { id: 'meta-noindex', title: 'Meta noindex pages', description: 'Rendered pages containing noindex directives.', severity: 'high', count: countIssue(results, 'meta-noindex') },
        { id: 'meta-nofollow', title: 'Meta nofollow pages', description: 'Rendered pages containing nofollow directives.', severity: 'medium', count: countIssue(results, 'meta-nofollow') },
        { id: 'missing-title', title: 'Missing titles', description: 'Pages without rendered title tags.', severity: 'high', count: countIssue(results, 'missing-title') },
        { id: 'duplicate-title', title: 'Duplicate titles', description: 'Multiple audited pages share the same title.', severity: 'medium', count: countIssue(results, 'duplicate-title') },
        { id: 'missing-desc', title: 'Missing descriptions', description: 'Pages without rendered meta descriptions.', severity: 'medium', count: countIssue(results, 'missing-desc') },
        { id: 'duplicate-desc', title: 'Duplicate descriptions', description: 'Multiple audited pages share the same meta description.', severity: 'low', count: countIssue(results, 'duplicate-desc') },
        { id: 'no-h1', title: 'Missing H1s', description: 'Pages without a primary H1 heading.', severity: 'high', count: countIssue(results, 'no-h1') },
        { id: 'multi-h1', title: 'Multiple H1s', description: 'Pages with more than one H1 heading.', severity: 'medium', count: countIssue(results, 'multi-h1') },
        { id: 'low-word-count', title: 'Thin content', description: 'Pages below the 300-word rendered content threshold.', severity: 'medium', count: countIssue(results, 'low-word-count') },
        { id: 'missing-viewport', title: 'Missing viewport', description: 'Pages without mobile viewport tags.', severity: 'medium', count: countIssue(results, 'missing-viewport') },
        { id: 'missing-html-lang', title: 'Missing HTML lang', description: 'Pages without an html lang attribute.', severity: 'low', count: countIssue(results, 'missing-html-lang') },
        { id: 'title-h1-duplicate', title: 'Title/H1 duplicates', description: 'Pages where the title tag and H1 are identical.', severity: 'low', count: countIssue(results, 'title-h1-duplicate') },
        { id: 'image-alt-missing', title: 'Image alt gaps', description: 'Images missing descriptive alt text.', severity: 'low', count: countIssue(results, 'image-alt-missing') },
        { id: 'image-dimensions-missing', title: 'Image dimension gaps', description: 'Images without width and height attributes.', severity: 'low', count: countIssue(results, 'image-dimensions-missing') },
        { id: 'open-graph-missing', title: 'Open Graph gaps', description: 'Pages missing core Open Graph sharing tags.', severity: 'low', count: countIssue(results, 'open-graph-missing') },
        { id: 'twitter-card-missing', title: 'Twitter Card gaps', description: 'Pages missing core Twitter/X sharing tags.', severity: 'low', count: countIssue(results, 'twitter-card-missing') },
        { id: 'hreflang-invalid', title: 'Invalid hreflang', description: 'Alternate language annotations with invalid hreflang values.', severity: 'medium', count: countIssue(results, 'hreflang-invalid') },
        { id: 'mixed-content', title: 'Mixed content', description: 'HTTPS pages loading insecure HTTP assets.', severity: 'high', count: countIssue(results, 'mixed-content') },
        { id: 'slow-mobile', title: 'Slow mobile PSI', description: 'Mobile PageSpeed score below 90.', severity: 'medium', count: countIssue(results, 'slow-mobile') },
        { id: 'slow-desktop', title: 'Slow desktop PSI', description: 'Desktop PageSpeed score below 90.', severity: 'medium', count: countIssue(results, 'slow-desktop') },
        { id: 'core-web-vitals', title: 'Core Web Vitals issues', description: 'LCP, CLS, or INP values outside good thresholds.', severity: 'medium', count: countIssue(results, 'core-web-vitals') },
        { id: 'broken-link', title: 'Broken links', description: 'Internal or external links returning errors.', severity: 'high', count: countIssue(results, 'broken-link') },
        { id: 'schema-errors', title: 'Schema errors', description: 'Invalid JSON-LD or required structured data gaps.', severity: 'high', count: countIssue(results, 'schema-errors') },
        { id: 'schema-warnings', title: 'Schema warnings', description: 'Structured data is present but incomplete.', severity: 'medium', count: countIssue(results, 'schema-warnings') },
        { id: 'indexed-orphan', title: 'Indexed orphans', description: 'Indexed pages with zero internal links.', severity: 'medium', count: countIssue(results, 'indexed-orphan') },
        { id: 'high-value-underlinked', title: 'Underlinked valuable pages', description: 'Traffic or long-form pages with weak internal support.', severity: 'low', count: countIssue(results, 'high-value-underlinked') },
    ];

    return cards.filter((card) => card.count > 0);
}

export function countTechnicalIssuesBySeverity(results: AuditResult[]) {
    return results.reduce((counts, result) => {
        getTechnicalIssues(result, results).forEach((issue) => {
            counts[issue.severity] += 1;
        });
        return counts;
    }, { critical: 0, high: 0, medium: 0, low: 0, info: 0 });
}
