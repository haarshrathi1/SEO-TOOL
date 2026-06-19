const RICH_RESULT_TYPES = new Set([
    'Article',
    'BlogPosting',
    'BreadcrumbList',
    'FAQPage',
    'HowTo',
    'LocalBusiness',
    'NewsArticle',
    'Product',
    'Recipe',
    'VideoObject',
]);

function ensureArray(value) {
    if (Array.isArray(value)) {
        return value;
    }

    if (value === undefined || value === null) {
        return [];
    }

    return [value];
}

function normalizeTypeName(value) {
    if (typeof value !== 'string') {
        return '';
    }

    const trimmed = value.trim();
    if (!trimmed) {
        return '';
    }

    const parts = trimmed.split(/[\/#]/);
    return parts[parts.length - 1] || trimmed;
}

function getEntityTypes(entity) {
    return ensureArray(entity?.['@type'])
        .map(normalizeTypeName)
        .filter(Boolean);
}

function flattenEntities(node) {
    const entities = [];

    function visit(value) {
        if (!value) {
            return;
        }

        if (Array.isArray(value)) {
            value.forEach(visit);
            return;
        }

        if (typeof value !== 'object') {
            return;
        }

        const graph = value['@graph'];
        if (graph) {
            visit(graph);
        }

        const types = getEntityTypes(value);
        if (types.length > 0) {
            entities.push(value);
        }
    }

    visit(node);
    return entities;
}

function hasValue(value) {
    if (Array.isArray(value)) {
        return value.length > 0;
    }

    if (value && typeof value === 'object') {
        return Object.keys(value).length > 0;
    }

    return value !== undefined && value !== null && String(value).trim() !== '';
}

function pushIssue(issues, code, severity, type, message) {
    issues.push({ code, severity, type, message });
}

function validateEntity(entity, issues) {
    const types = getEntityTypes(entity);
    const hasType = (expected) => types.includes(expected);
    const primaryType = types[0] || 'Schema';

    if (hasType('BreadcrumbList')) {
        if (!ensureArray(entity.itemListElement).length) {
            pushIssue(issues, 'breadcrumb-missing-items', 'error', 'BreadcrumbList', 'BreadcrumbList is missing itemListElement entries.');
        }
    }

    if (hasType('FAQPage')) {
        const questions = ensureArray(entity.mainEntity);
        if (!questions.length) {
            pushIssue(issues, 'faq-missing-questions', 'error', 'FAQPage', 'FAQPage is missing mainEntity questions.');
        } else if (questions.some((question) => !hasValue(question?.name) || !hasValue(question?.acceptedAnswer?.text))) {
            pushIssue(issues, 'faq-incomplete-answer', 'warning', 'FAQPage', 'FAQPage has questions without both a prompt and an accepted answer.');
        }
    }

    if (hasType('Product')) {
        if (!hasValue(entity.name)) {
            pushIssue(issues, 'product-missing-name', 'error', 'Product', 'Product schema is missing a product name.');
        }
        if (!hasValue(entity.offers) && !hasValue(entity.aggregateRating) && !hasValue(entity.review)) {
            pushIssue(issues, 'product-missing-commerce-data', 'warning', 'Product', 'Product schema is missing offers, ratings, or reviews.');
        }
    }

    if (hasType('Article') || hasType('BlogPosting') || hasType('NewsArticle')) {
        if (!hasValue(entity.headline)) {
            pushIssue(issues, 'article-missing-headline', 'error', primaryType, `${primaryType} schema is missing a headline.`);
        }
        if (!hasValue(entity.author)) {
            pushIssue(issues, 'article-missing-author', 'warning', primaryType, `${primaryType} schema is missing an author.`);
        }
        if (!hasValue(entity.datePublished)) {
            pushIssue(issues, 'article-missing-date', 'warning', primaryType, `${primaryType} schema is missing datePublished.`);
        }
    }

    if (hasType('Organization') || hasType('LocalBusiness')) {
        if (!hasValue(entity.name)) {
            pushIssue(issues, 'organization-missing-name', 'warning', primaryType, `${primaryType} schema is missing a name.`);
        }
    }

    if (hasType('LocalBusiness')) {
        if (!hasValue(entity.address) && !hasValue(entity.telephone)) {
            pushIssue(issues, 'local-business-contact-gap', 'warning', 'LocalBusiness', 'LocalBusiness schema is missing both address and telephone.');
        }
    }

    if (hasType('WebSite')) {
        if (!hasValue(entity.name)) {
            pushIssue(issues, 'website-missing-name', 'warning', 'WebSite', 'WebSite schema is missing a name.');
        }
        if (!hasValue(entity.url)) {
            pushIssue(issues, 'website-missing-url', 'warning', 'WebSite', 'WebSite schema is missing a url.');
        }
    }
}

function summarizeStructuredData(raw = {}) {
    const jsonLdBlocks = ensureArray(raw.jsonLdBlocks).filter((block) => typeof block === 'string' && block.trim());
    const microdataTypes = ensureArray(raw.microdataTypes)
        .map(normalizeTypeName)
        .filter(Boolean);
    const parseErrors = [];
    const issues = [];
    const entities = [];

    jsonLdBlocks.forEach((block, index) => {
        try {
            const parsed = JSON.parse(block);
            entities.push(...flattenEntities(parsed));
        } catch {
            parseErrors.push(`Invalid JSON-LD block ${index + 1}`);
        }
    });

    const itemTypes = new Set(microdataTypes);
    const richResultTypes = new Set();

    entities.forEach((entity) => {
        const types = getEntityTypes(entity);
        types.forEach((type) => {
            itemTypes.add(type);
            if (RICH_RESULT_TYPES.has(type)) {
                richResultTypes.add(type);
            }
        });
        validateEntity(entity, issues);
    });

    microdataTypes.forEach((type) => {
        if (RICH_RESULT_TYPES.has(type)) {
            richResultTypes.add(type);
        }
    });

    return {
        hasStructuredData: jsonLdBlocks.length > 0 || microdataTypes.length > 0 || parseErrors.length > 0,
        valid: (jsonLdBlocks.length > 0 || microdataTypes.length > 0) && parseErrors.length === 0 && !issues.some((issue) => issue.severity === 'error'),
        totalItems: entities.length + microdataTypes.length,
        jsonLdCount: jsonLdBlocks.length,
        microdataCount: microdataTypes.length,
        itemTypes: [...itemTypes].sort(),
        richResultTypes: [...richResultTypes].sort(),
        parseErrors,
        issues,
    };
}

module.exports = {
    summarizeStructuredData,
    __internal: {
        ensureArray,
        flattenEntities,
        getEntityTypes,
        normalizeTypeName,
        validateEntity,
    },
};
