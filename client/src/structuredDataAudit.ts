import type { AuditResult } from './types';

export type StructuredDataFilterId =
    | 'schema-missing'
    | 'schema-errors'
    | 'schema-warnings'
    | 'rich-result-ready'
    | 'breadcrumb-issues'
    | 'article-issues'
    | 'faq-issues'
    | 'product-issues'
    | 'organization-issues';

interface StructuredDataCard {
    id: StructuredDataFilterId;
    title: string;
    description: string;
    tone: 'critical' | 'warning' | 'positive' | 'info';
    count: number;
    sampleUrls: string[];
}

interface StructuredDataMetric {
    label: string;
    value: number;
    detail: string;
}

interface StructuredDataTypeBreakdown {
    type: string;
    count: number;
}

interface StructuredDataIssueBreakdown {
    label: string;
    count: number;
}

export interface StructuredDataAuditModel {
    hasData: boolean;
    metrics: StructuredDataMetric[];
    cards: StructuredDataCard[];
    topTypes: StructuredDataTypeBreakdown[];
    commonIssues: StructuredDataIssueBreakdown[];
}

const TYPE_GROUPS = {
    breadcrumb: ['BreadcrumbList'],
    article: ['Article', 'BlogPosting', 'NewsArticle'],
    faq: ['FAQPage'],
    product: ['Product'],
    organization: ['Organization', 'LocalBusiness', 'WebSite'],
} as const;

const STRUCTURED_DATA_FILTER_IDS = [
    'schema-missing',
    'schema-errors',
    'schema-warnings',
    'rich-result-ready',
    'breadcrumb-issues',
    'article-issues',
    'faq-issues',
    'product-issues',
    'organization-issues',
] as const satisfies StructuredDataFilterId[];

function sampleUrls(results: AuditResult[], max = 4) {
    return results.slice(0, max).map((result) => result.url);
}

export function hasStructuredDataData(results: AuditResult[]) {
    return results.some((result) => result.structuredData !== undefined);
}

export function hasStructuredDataError(result: AuditResult) {
    return Boolean(result.structuredData && (
        result.structuredData.parseErrors.length > 0
        || result.structuredData.issues.some((issue) => issue.severity === 'error')
    ));
}

export function hasStructuredDataWarning(result: AuditResult) {
    return Boolean(result.structuredData && result.structuredData.issues.some((issue) => issue.severity === 'warning'));
}

function isRichResultReady(result: AuditResult) {
    return Boolean(result.structuredData && result.structuredData.richResultTypes.length > 0 && !hasStructuredDataError(result));
}

function hasTypeGroupIssue(result: AuditResult, types: readonly string[]) {
    return Boolean(result.structuredData?.issues.some((issue) => types.includes(issue.type)));
}

export function getStructuredDataBadges(result: AuditResult) {
    if (hasStructuredDataError(result)) {
        return [{ label: 'Schema errors', tone: 'critical' as const }];
    }

    if (hasStructuredDataWarning(result)) {
        return [{ label: 'Schema warning', tone: 'warning' as const }];
    }

    if (isRichResultReady(result)) {
        return [{ label: 'Rich result ready', tone: 'positive' as const }];
    }

    if (result.structuredData?.hasStructuredData) {
        return [{ label: 'Schema detected', tone: 'info' as const }];
    }

    return [];
}

function matchesStructuredDataFilter(result: AuditResult, filterId: StructuredDataFilterId) {
    switch (filterId) {
        case 'schema-missing':
            return Boolean(result.structuredData && result.structuredData.totalItems === 0 && result.structuredData.parseErrors.length === 0);
        case 'schema-errors':
            return hasStructuredDataError(result);
        case 'schema-warnings':
            return !hasStructuredDataError(result) && hasStructuredDataWarning(result);
        case 'rich-result-ready':
            return isRichResultReady(result);
        case 'breadcrumb-issues':
            return hasTypeGroupIssue(result, TYPE_GROUPS.breadcrumb);
        case 'article-issues':
            return hasTypeGroupIssue(result, TYPE_GROUPS.article);
        case 'faq-issues':
            return hasTypeGroupIssue(result, TYPE_GROUPS.faq);
        case 'product-issues':
            return hasTypeGroupIssue(result, TYPE_GROUPS.product);
        case 'organization-issues':
            return hasTypeGroupIssue(result, TYPE_GROUPS.organization);
        default:
            return false;
    }
}

export function isStructuredDataFilterId(filterId: string): filterId is StructuredDataFilterId {
    return STRUCTURED_DATA_FILTER_IDS.includes(filterId as StructuredDataFilterId);
}

export function filterResultsByStructuredDataFilter(results: AuditResult[], filterId: StructuredDataFilterId) {
    return results.filter((result) => matchesStructuredDataFilter(result, filterId));
}

export interface SchemaRecommendation {
    schemaType: string;
    action: 'add' | 'fill';
    priority: 'high' | 'medium' | 'low';
    reason: string;
    suggestedFields?: Record<string, string>;
}

export interface SchemaOpportunity {
    schemaType: string;
    action: 'add' | 'fill';
    priority: 'high' | 'medium' | 'low';
    count: number;
    sampleUrls: string[];
    reason: string;
}

export interface SchemaOpportunitiesModel {
    totalPagesWithOpportunities: number;
    opportunities: SchemaOpportunity[];
}

export function buildSchemaRecommendationsForPage(result: AuditResult): SchemaRecommendation[] {
    if (result.contentBlocked || (result.httpStatus !== undefined && result.httpStatus >= 400)) return [];

    const urlLower = result.url.toLowerCase();
    const titleLower = (result.title || '').toLowerCase();
    const h1Lower = (result.h1Text || '').toLowerCase();
    const combined = `${urlLower} ${titleLower} ${h1Lower}`;
    const existingTypes = new Set(result.structuredData?.itemTypes || []);
    const has = (type: string) => existingTypes.has(type);

    const recs: SchemaRecommendation[] = [];

    // Product
    const isProduct = /\/(product|shop|buy|item|sku|p\/|pdp)[/\-_]/.test(urlLower)
        || /(price|buy now|add to cart|add to bag|\$\s*\d|€\s*\d|£\s*\d)/i.test(combined);
    if (isProduct && !has('Product')) {
        recs.push({ schemaType: 'Product', action: 'add', priority: 'high', reason: 'Product page signals detected (URL or pricing/CTA keywords). Product schema enables rich results with price and availability.', suggestedFields: { name: result.h1Text || result.title || '' } });
    }

    // Article / BlogPosting
    const isBlog = /\/(blog|article|post|news|story)[/\-_]/.test(urlLower) || /(written by|published|author|min read)/i.test(combined);
    const isLongContent = (result.wordCount || 0) > 600;
    const h1WordCount = (result.h1Text || '').trim().split(/\s+/).filter(Boolean).length;
    if (isBlog && isLongContent && h1WordCount >= 4 && !has('Article') && !has('BlogPosting') && !has('NewsArticle')) {
        recs.push({ schemaType: 'BlogPosting', action: 'add', priority: 'medium', reason: 'Blog/article page with long-form content detected. Article schema enables author rich results and better indexation signals.', suggestedFields: { headline: result.h1Text || result.title || '' } });
    }

    // FAQPage
    const isFaq = /\/(faq|help|support|questions)[/\-_]/.test(urlLower) || /(frequently asked|faq|q&a)/i.test(combined);
    if (isFaq && !has('FAQPage')) {
        recs.push({ schemaType: 'FAQPage', action: 'add', priority: 'high', reason: 'FAQ content detected. FAQPage schema can display Q&As directly in search results, improving CTR.' });
    }

    // Recipe
    const isRecipe = /\/(recipe|cook|bake)[/\-_]/.test(urlLower) || /(recipe|ingredients|prep time|cook time)/i.test(combined);
    if (isRecipe && !has('Recipe')) {
        recs.push({ schemaType: 'Recipe', action: 'add', priority: 'high', reason: 'Recipe content detected. Recipe schema enables rich results with ratings, cook time, and calories.', suggestedFields: { name: result.h1Text || result.title || '' } });
    }

    // HowTo
    const isHowTo = h1Lower.startsWith('how to') || /\/(how-to|tutorial|step-by-step)[/\-_]/.test(urlLower);
    if (isHowTo && !has('HowTo')) {
        recs.push({ schemaType: 'HowTo', action: 'add', priority: 'medium', reason: 'How-to content detected. HowTo schema enables step-by-step rich results in Google Search.', suggestedFields: { name: result.h1Text || result.title || '' } });
    }

    // LocalBusiness
    const isLocalPage = /\/(contact|location|about|store|branch|find-us)[/\-_]/.test(urlLower);
    const hasLocalSignals = /(address|phone|open|hours|directions|get in touch)/i.test(combined);
    if (isLocalPage && hasLocalSignals && !has('LocalBusiness') && !has('Organization')) {
        recs.push({ schemaType: 'LocalBusiness', action: 'add', priority: 'high', reason: 'Local business contact/location page detected. LocalBusiness schema improves local search visibility and Google Maps integration.', suggestedFields: { name: result.title || '' } });
    }

    // BreadcrumbList — only suggest for non-root pages that already have other schema
    const urlPath = (() => { try { return new URL(result.url).pathname; } catch { return ''; } })();
    const isNonRoot = urlPath.length > 1 && urlPath !== '/';
    if (isNonRoot && !has('BreadcrumbList') && existingTypes.size > 0) {
        recs.push({ schemaType: 'BreadcrumbList', action: 'add', priority: 'low', reason: 'No BreadcrumbList schema detected on a page that already uses other schema types. Breadcrumbs improve navigation display in SERPs.' });
    }

    // Fill recommendations: surface existing schema errors as actionable fills
    (result.structuredData?.issues || []).forEach((issue) => {
        if (issue.severity === 'error') {
            recs.push({ schemaType: issue.type, action: 'fill', priority: 'high', reason: issue.message });
        }
    });

    return recs;
}

export function buildSchemaOpportunitiesModel(results: AuditResult[]): SchemaOpportunitiesModel {
    const opportunityMap = new Map<string, { opp: SchemaOpportunity; pages: Set<string> }>();
    const pagesWithOpportunities = new Set<string>();

    results.forEach((result) => {
        const recs = buildSchemaRecommendationsForPage(result);
        if (recs.length > 0) pagesWithOpportunities.add(result.url);

        recs.forEach((rec) => {
            const key = `${rec.schemaType}::${rec.action}`;
            if (!opportunityMap.has(key)) {
                opportunityMap.set(key, {
                    opp: { schemaType: rec.schemaType, action: rec.action, priority: rec.priority, count: 0, sampleUrls: [], reason: rec.reason },
                    pages: new Set(),
                });
            }
            const entry = opportunityMap.get(key)!;
            if (!entry.pages.has(result.url)) {
                entry.pages.add(result.url);
                entry.opp.count += 1;
                if (entry.opp.sampleUrls.length < 4) entry.opp.sampleUrls.push(result.url);
            }
        });
    });

    const priorityOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
    const opportunities = [...opportunityMap.values()]
        .map((e) => e.opp)
        .sort((a, b) => (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3) || b.count - a.count);

    return { totalPagesWithOpportunities: pagesWithOpportunities.size, opportunities };
}

export function buildStructuredDataAuditModel(results: AuditResult[]): StructuredDataAuditModel {
    const pagesWithSchema = results.filter((result) => (result.structuredData?.totalItems || 0) > 0);
    const pagesMissingSchema = results.filter((result) => matchesStructuredDataFilter(result, 'schema-missing'));
    const pagesWithErrors = results.filter((result) => matchesStructuredDataFilter(result, 'schema-errors'));
    const pagesWithWarnings = results.filter((result) => matchesStructuredDataFilter(result, 'schema-warnings'));
    const richResultReady = results.filter((result) => matchesStructuredDataFilter(result, 'rich-result-ready'));

    const typeCounts = new Map<string, number>();
    const issueCounts = new Map<string, number>();

    results.forEach((result) => {
        (result.structuredData?.itemTypes || []).forEach((type) => {
            typeCounts.set(type, (typeCounts.get(type) || 0) + 1);
        });

        (result.structuredData?.parseErrors || []).forEach((label) => {
            issueCounts.set(label, (issueCounts.get(label) || 0) + 1);
        });

        (result.structuredData?.issues || []).forEach((issue) => {
            issueCounts.set(issue.message, (issueCounts.get(issue.message) || 0) + 1);
        });
    });

    const cards: StructuredDataCard[] = [
        {
            id: 'schema-missing',
            title: 'Missing schema',
            description: 'Pages without JSON-LD or microdata in the current snapshot.',
            tone: 'warning',
            count: pagesMissingSchema.length,
            sampleUrls: sampleUrls(pagesMissingSchema),
        },
        {
            id: 'schema-errors',
            title: 'Schema errors',
            description: 'Pages with invalid JSON-LD or missing required fields.',
            tone: 'critical',
            count: pagesWithErrors.length,
            sampleUrls: sampleUrls(pagesWithErrors),
        },
        {
            id: 'schema-warnings',
            title: 'Schema warnings',
            description: 'Pages with structured data that is present but incomplete.',
            tone: 'warning',
            count: pagesWithWarnings.length,
            sampleUrls: sampleUrls(pagesWithWarnings),
        },
        {
            id: 'rich-result-ready',
            title: 'Rich result ready',
            description: 'Pages with rich-result schema types and no schema errors.',
            tone: 'positive',
            count: richResultReady.length,
            sampleUrls: sampleUrls(richResultReady),
        },
        {
            id: 'breadcrumb-issues',
            title: 'Breadcrumb schema issues',
            description: 'Problems inside BreadcrumbList implementations.',
            tone: 'info',
            count: filterResultsByStructuredDataFilter(results, 'breadcrumb-issues').length,
            sampleUrls: sampleUrls(filterResultsByStructuredDataFilter(results, 'breadcrumb-issues')),
        },
        {
            id: 'article-issues',
            title: 'Article schema issues',
            description: 'Headline, author, or date gaps in article markup.',
            tone: 'info',
            count: filterResultsByStructuredDataFilter(results, 'article-issues').length,
            sampleUrls: sampleUrls(filterResultsByStructuredDataFilter(results, 'article-issues')),
        },
        {
            id: 'faq-issues',
            title: 'FAQ schema issues',
            description: 'Missing FAQ questions or incomplete answer structures.',
            tone: 'info',
            count: filterResultsByStructuredDataFilter(results, 'faq-issues').length,
            sampleUrls: sampleUrls(filterResultsByStructuredDataFilter(results, 'faq-issues')),
        },
        {
            id: 'product-issues',
            title: 'Product schema issues',
            description: 'Missing product names, offers, reviews, or ratings.',
            tone: 'info',
            count: filterResultsByStructuredDataFilter(results, 'product-issues').length,
            sampleUrls: sampleUrls(filterResultsByStructuredDataFilter(results, 'product-issues')),
        },
        {
            id: 'organization-issues',
            title: 'Org and site schema issues',
            description: 'Name, contact, or WebSite metadata gaps.',
            tone: 'info',
            count: filterResultsByStructuredDataFilter(results, 'organization-issues').length,
            sampleUrls: sampleUrls(filterResultsByStructuredDataFilter(results, 'organization-issues')),
        },
    ];

    return {
        hasData: hasStructuredDataData(results),
        metrics: [
            {
                label: 'Pages with schema',
                value: pagesWithSchema.length,
                detail: 'Any JSON-LD or microdata detected',
            },
            {
                label: 'Rich result ready',
                value: richResultReady.length,
                detail: 'Rich-result types without schema errors',
            },
            {
                label: 'Schema errors',
                value: pagesWithErrors.length,
                detail: 'Invalid or incomplete critical markup',
            },
            {
                label: 'Schema warnings',
                value: pagesWithWarnings.length,
                detail: 'Non-critical structured data gaps',
            },
            {
                label: 'Missing schema',
                value: pagesMissingSchema.length,
                detail: 'Pages with no structured data detected',
            },
        ],
        cards,
        topTypes: [...typeCounts.entries()]
            .map(([type, count]) => ({ type, count }))
            .sort((left, right) => right.count - left.count || left.type.localeCompare(right.type))
            .slice(0, 8),
        commonIssues: [...issueCounts.entries()]
            .map(([label, count]) => ({ label, count }))
            .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
            .slice(0, 8),
    };
}
