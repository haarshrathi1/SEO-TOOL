const ISSUE_SEVERITY_ORDER = {
    critical: 4,
    high: 3,
    medium: 2,
    low: 1,
    info: 0,
};

const CANONICAL_ISSUE_META = {
    'redirected-url': {
        category: 'canonical',
        severity: 'medium',
        title: 'Sitemap URL redirects',
        details: 'The crawled URL redirects before reaching its final URL.',
    },
    'redirect-chain': {
        category: 'canonical',
        severity: 'high',
        title: 'Redirect chain detected',
        details: 'The crawled URL redirects through more than one hop.',
    },
    'missing-canonical': {
        category: 'canonical',
        severity: 'medium',
        title: 'Missing canonical tag',
        details: 'The page does not expose a canonical URL.',
    },
    'multiple-canonicals': {
        category: 'canonical',
        severity: 'high',
        title: 'Multiple canonical tags',
        details: 'The page exposes more than one canonical URL.',
    },
    'canonical-mismatch': {
        category: 'canonical',
        severity: 'medium',
        title: 'Canonical points away',
        details: 'The canonical URL does not match the final crawled URL.',
    },
    'cross-domain-canonical': {
        category: 'canonical',
        severity: 'high',
        title: 'Cross-domain canonical',
        details: 'The page canonicalizes to a different host.',
    },
    'canonical-target-redirects': {
        category: 'canonical',
        severity: 'high',
        title: 'Canonical target redirects',
        details: 'The canonical target is itself a redirecting URL.',
    },
    'canonical-loop': {
        category: 'canonical',
        severity: 'critical',
        title: 'Canonical loop',
        details: 'Two or more pages canonicalize in a cycle.',
    },
};

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function countTextLength(value) {
    return cleanText(value).length;
}

function normalizeComparableText(value) {
    return cleanText(value).toLowerCase();
}

function getDisplayNumber(value) {
    const match = String(value || '').replace(/,/g, '').match(/(\d+(?:\.\d+)?)/);
    return match ? Number(match[1]) : null;
}

function parseSeconds(displayValue) {
    const text = String(displayValue || '').toLowerCase();
    const value = getDisplayNumber(text);
    if (!Number.isFinite(value)) {
        return null;
    }

    return text.includes('ms') ? value / 1000 : value;
}

function parseMilliseconds(displayValue) {
    const text = String(displayValue || '').toLowerCase();
    const value = getDisplayNumber(text);
    if (!Number.isFinite(value)) {
        return null;
    }

    return text.includes(' s') || text.endsWith('s') ? value * 1000 : value;
}

function pushIssue(issues, issue) {
    issues.push({
        id: issue.id,
        category: issue.category || 'technical',
        severity: issue.severity || 'medium',
        title: issue.title,
        details: issue.details || '',
        metadata: issue.metadata || {},
    });
}

function isBlockedPage(result) {
    return Boolean(result?.contentBlocked || (Number(result?.httpStatus || 0) >= 400));
}

function isIndexablePass(result) {
    return String(result?.status || '').toUpperCase() === 'PASS';
}

function getMissingSocialFields(socialMeta = {}) {
    const missing = [];
    if (!cleanText(socialMeta.ogTitle)) missing.push('og:title');
    if (!cleanText(socialMeta.ogDescription)) missing.push('og:description');
    if (!cleanText(socialMeta.ogImage)) missing.push('og:image');
    if (!cleanText(socialMeta.twitterCard)) missing.push('twitter:card');
    if (!cleanText(socialMeta.twitterTitle)) missing.push('twitter:title');
    if (!cleanText(socialMeta.twitterDescription)) missing.push('twitter:description');
    if (!cleanText(socialMeta.twitterImage)) missing.push('twitter:image');
    return missing;
}

function isLikelyInvalidHreflang(value) {
    const normalized = cleanText(value).toLowerCase();
    if (!normalized || normalized === 'x-default') {
        return false;
    }

    return !/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(normalized);
}

function getPsiScore(result, strategy) {
    const score = Number(result?.psi_data?.[strategy]?.score);
    return Number.isFinite(score) && score > 0 ? score : null;
}

function addCoreWebVitalIssues(issues, result, strategy) {
    const psiData = result?.psi_data?.[strategy];
    if (!psiData) {
        return;
    }

    const lcp = parseSeconds(psiData.lcp);
    if (lcp !== null && lcp > 2.5) {
        pushIssue(issues, {
            id: `${strategy}-lcp-${lcp > 4 ? 'poor' : 'needs-improvement'}`,
            category: 'performance',
            severity: lcp > 4 ? 'high' : 'medium',
            title: `${strategy === 'mobile' ? 'Mobile' : 'Desktop'} LCP needs work`,
            details: `Largest Contentful Paint is ${psiData.lcp}.`,
            metadata: { strategy, metric: 'lcp', value: psiData.lcp },
        });
    }

    const cls = getDisplayNumber(psiData.cls);
    if (cls !== null && cls > 0.1) {
        pushIssue(issues, {
            id: `${strategy}-cls-${cls > 0.25 ? 'poor' : 'needs-improvement'}`,
            category: 'performance',
            severity: cls > 0.25 ? 'high' : 'medium',
            title: `${strategy === 'mobile' ? 'Mobile' : 'Desktop'} CLS needs work`,
            details: `Cumulative Layout Shift is ${psiData.cls}.`,
            metadata: { strategy, metric: 'cls', value: psiData.cls },
        });
    }

    const inp = parseMilliseconds(psiData.inp);
    if (inp !== null && inp > 200) {
        pushIssue(issues, {
            id: `${strategy}-inp-${inp > 500 ? 'poor' : 'needs-improvement'}`,
            category: 'performance',
            severity: inp > 500 ? 'high' : 'medium',
            title: `${strategy === 'mobile' ? 'Mobile' : 'Desktop'} INP needs work`,
            details: `Interaction to Next Paint is ${psiData.inp}.`,
            metadata: { strategy, metric: 'inp', value: psiData.inp },
        });
    }
}

function buildDuplicateLookup(results, fieldName) {
    const counts = new Map();
    for (const result of Array.isArray(results) ? results : []) {
        const value = normalizeComparableText(result?.[fieldName]);
        if (!value) {
            continue;
        }

        counts.set(value, (counts.get(value) || 0) + 1);
    }
    return counts;
}

function buildIssueContext(results) {
    return {
        titleCounts: buildDuplicateLookup(results, 'title'),
        descriptionCounts: buildDuplicateLookup(results, 'description'),
    };
}

function collectTechnicalIssues(result, context = {}) {
    const issues = [];
    const blocked = isBlockedPage(result);
    const httpStatus = Number(result?.httpStatus || 0);
    const title = cleanText(result?.title);
    const description = cleanText(result?.description);
    const robotsMeta = cleanText(result?.robotsMeta).toLowerCase();
    const viewport = cleanText(result?.viewport);
    const htmlLang = cleanText(result?.htmlLang);

    if (httpStatus >= 500) {
        pushIssue(issues, {
            id: 'http-5xx',
            category: 'crawlability',
            severity: 'critical',
            title: 'Server error',
            details: `The page returned HTTP ${httpStatus}.`,
            metadata: { httpStatus },
        });
    } else if (httpStatus >= 400) {
        pushIssue(issues, {
            id: 'http-4xx',
            category: 'crawlability',
            severity: 'high',
            title: 'Client error',
            details: `The page returned HTTP ${httpStatus}.`,
            metadata: { httpStatus },
        });
    } else if (result?.contentBlocked) {
        pushIssue(issues, {
            id: 'content-unreachable',
            category: 'crawlability',
            severity: 'high',
            title: 'Content not reachable',
            details: result.contentBlockedReason || 'The rendered page content could not be read.',
            metadata: { reason: result.contentBlockedReason || '' },
        });
    }

    if (!isIndexablePass(result)) {
        pushIssue(issues, {
            id: 'not-indexed',
            category: 'indexation',
            severity: /blocked|server error|not found|soft 404|error/i.test([result?.coverageState, result?.indexingState].join(' ')) ? 'high' : 'medium',
            title: 'Page is not passing index checks',
            details: result?.coverageState || result?.indexingState || result?.status || 'Not indexed',
            metadata: {
                status: result?.status,
                coverageState: result?.coverageState,
                indexingState: result?.indexingState,
            },
        });
    }

    if (/blocked|robots/i.test([result?.coverageState, result?.indexingState, result?.robotStatus].join(' '))) {
        pushIssue(issues, {
            id: 'robots-blocked',
            category: 'indexation',
            severity: 'high',
            title: 'Blocked by robots rules',
            details: result?.robotStatus || result?.coverageState || 'Robots blocking signal detected.',
            metadata: { robotStatus: result?.robotStatus },
        });
    }

    if (robotsMeta.includes('noindex')) {
        pushIssue(issues, {
            id: 'meta-noindex',
            category: 'indexation',
            severity: 'high',
            title: 'Meta noindex detected',
            details: 'The rendered page contains a noindex directive.',
            metadata: { robotsMeta },
        });
    }

    if (robotsMeta.includes('nofollow')) {
        pushIssue(issues, {
            id: 'meta-nofollow',
            category: 'indexation',
            severity: 'medium',
            title: 'Meta nofollow detected',
            details: 'The rendered page contains a nofollow directive.',
            metadata: { robotsMeta },
        });
    }

    if (!blocked) {
        const titleLength = countTextLength(title);
        if (!title) {
            pushIssue(issues, {
                id: 'missing-title',
                category: 'metadata',
                severity: 'high',
                title: 'Missing title tag',
                details: 'The page has no rendered document title.',
            });
        } else {
            if (titleLength < 30) {
                pushIssue(issues, {
                    id: 'short-title',
                    category: 'metadata',
                    severity: 'low',
                    title: 'Title is too short',
                    details: `The title is ${titleLength} characters.`,
                    metadata: { titleLength },
                });
            }
            if (titleLength > 60) {
                pushIssue(issues, {
                    id: 'long-title',
                    category: 'metadata',
                    severity: 'low',
                    title: 'Title is too long',
                    details: `The title is ${titleLength} characters.`,
                    metadata: { titleLength },
                });
            }
            if ((context.titleCounts?.get(normalizeComparableText(title)) || 0) > 1) {
                pushIssue(issues, {
                    id: 'duplicate-title',
                    category: 'metadata',
                    severity: 'medium',
                    title: 'Duplicate title',
                    details: 'Another audited page uses the same title.',
                    metadata: { title },
                });
            }
        }

        const descriptionLength = countTextLength(description);
        if (!description) {
            pushIssue(issues, {
                id: 'missing-desc',
                category: 'metadata',
                severity: 'medium',
                title: 'Missing meta description',
                details: 'The page has no rendered meta description.',
            });
        } else {
            if (descriptionLength < 70) {
                pushIssue(issues, {
                    id: 'short-desc',
                    category: 'metadata',
                    severity: 'low',
                    title: 'Meta description is too short',
                    details: `The description is ${descriptionLength} characters.`,
                    metadata: { descriptionLength },
                });
            }
            if (descriptionLength > 160) {
                pushIssue(issues, {
                    id: 'long-desc',
                    category: 'metadata',
                    severity: 'low',
                    title: 'Meta description is too long',
                    details: `The description is ${descriptionLength} characters.`,
                    metadata: { descriptionLength },
                });
            }
            if ((context.descriptionCounts?.get(normalizeComparableText(description)) || 0) > 1) {
                pushIssue(issues, {
                    id: 'duplicate-desc',
                    category: 'metadata',
                    severity: 'low',
                    title: 'Duplicate meta description',
                    details: 'Another audited page uses the same meta description.',
                    metadata: { description },
                });
            }
        }

        const h1Count = Number(result?.h1Count || 0);
        if (h1Count === 0) {
            pushIssue(issues, {
                id: 'no-h1',
                category: 'content',
                severity: 'high',
                title: 'Missing H1',
                details: 'The page has no H1 heading.',
            });
        } else if (h1Count > 1) {
            pushIssue(issues, {
                id: 'multi-h1',
                category: 'content',
                severity: 'medium',
                title: 'Multiple H1 headings',
                details: `The page has ${h1Count} H1 headings.`,
                metadata: { h1Count },
            });
        }

        const wordCount = Number(result?.wordCount || 0);
        if (wordCount > 0 && wordCount < 50) {
            pushIssue(issues, {
                id: 'very-thin-content',
                category: 'content',
                severity: 'high',
                title: 'Very thin content',
                details: `Only ${wordCount} rendered words were found.`,
                metadata: { wordCount },
            });
        } else if (wordCount < 300) {
            pushIssue(issues, {
                id: 'low-word-count',
                category: 'content',
                severity: 'medium',
                title: 'Low word count',
                details: `Only ${wordCount} rendered words were found.`,
                metadata: { wordCount },
            });
        }

        if (!viewport) {
            pushIssue(issues, {
                id: 'missing-viewport',
                category: 'mobile',
                severity: 'medium',
                title: 'Missing viewport tag',
                details: 'The page has no viewport meta tag.',
            });
        }

        if (!htmlLang) {
            pushIssue(issues, {
                id: 'missing-html-lang',
                category: 'internationalization',
                severity: 'low',
                title: 'Missing HTML language',
                details: 'The html element does not declare a lang attribute.',
            });
        }

        const h1Text = cleanText(Array.isArray(result?.h1s) ? result.h1s[0] : result?.h1Text);
        if (title && h1Text && normalizeComparableText(title) === normalizeComparableText(h1Text)) {
            pushIssue(issues, {
                id: 'title-h1-duplicate',
                category: 'content',
                severity: 'low',
                title: 'Title and H1 are identical',
                details: 'The title tag and primary H1 use the same text, leaving little room to target related phrasing.',
                metadata: { title, h1: h1Text },
            });
        }
    }

    const images = Array.isArray(result?.images) ? result.images : [];
    const missingAlt = images.filter((image) => !image?.hasAlt).length;
    if (!blocked && missingAlt > 0) {
        pushIssue(issues, {
            id: 'image-alt-missing',
            category: 'images',
            severity: missingAlt >= 5 ? 'medium' : 'low',
            title: 'Images missing alt text',
            details: `${missingAlt} image${missingAlt === 1 ? '' : 's'} have empty or missing alt text.`,
            metadata: { missingAlt, totalImages: images.length },
        });
    }

    const missingDimensions = images.filter((image) => !image?.hasDimensions).length;
    if (!blocked && missingDimensions > 0) {
        pushIssue(issues, {
            id: 'image-dimensions-missing',
            category: 'images',
            severity: missingDimensions >= 5 ? 'medium' : 'low',
            title: 'Images missing dimensions',
            details: `${missingDimensions} image${missingDimensions === 1 ? '' : 's'} do not declare width and height attributes.`,
            metadata: { missingDimensions, totalImages: images.length },
        });
    }

    if (Object.prototype.hasOwnProperty.call(result || {}, 'socialMeta')) {
        const missingSocialFields = getMissingSocialFields(result?.socialMeta || {});
        if (!blocked && missingSocialFields.some((field) => field.startsWith('og:'))) {
            pushIssue(issues, {
                id: 'open-graph-missing',
                category: 'metadata',
                severity: 'low',
                title: 'Open Graph tags incomplete',
                details: `Missing ${missingSocialFields.filter((field) => field.startsWith('og:')).join(', ')}.`,
                metadata: { missingSocialFields },
            });
        }
        if (!blocked && missingSocialFields.some((field) => field.startsWith('twitter:'))) {
            pushIssue(issues, {
                id: 'twitter-card-missing',
                category: 'metadata',
                severity: 'low',
                title: 'Twitter Card tags incomplete',
                details: `Missing ${missingSocialFields.filter((field) => field.startsWith('twitter:')).join(', ')}.`,
                metadata: { missingSocialFields },
            });
        }
    }

    const invalidHreflangs = (Array.isArray(result?.hreflangs) ? result.hreflangs : [])
        .filter((entry) => isLikelyInvalidHreflang(entry?.hreflang));
    if (invalidHreflangs.length > 0) {
        pushIssue(issues, {
            id: 'hreflang-invalid',
            category: 'internationalization',
            severity: 'medium',
            title: 'Invalid hreflang values',
            details: `${invalidHreflangs.length} hreflang value${invalidHreflangs.length === 1 ? '' : 's'} look invalid.`,
            metadata: { invalidHreflangs },
        });
    }

    const mixedContentUrls = Array.isArray(result?.mixedContentUrls) ? result.mixedContentUrls : [];
    if (mixedContentUrls.length > 0) {
        pushIssue(issues, {
            id: 'mixed-content',
            category: 'security',
            severity: 'high',
            title: 'Mixed content detected',
            details: `${mixedContentUrls.length} insecure HTTP asset${mixedContentUrls.length === 1 ? '' : 's'} found on an HTTPS page.`,
            metadata: { mixedContentUrls: mixedContentUrls.slice(0, 10) },
        });
    }

    for (const flag of Array.isArray(result?.canonicalIssues) ? result.canonicalIssues : []) {
        const meta = CANONICAL_ISSUE_META[flag];
        if (!meta) {
            continue;
        }
        pushIssue(issues, {
            id: flag,
            ...meta,
            metadata: { canonicalUrl: result?.canonicalUrl || '', finalUrl: result?.finalUrl || result?.url || '' },
        });
    }

    for (const brokenLink of Array.isArray(result?.brokenLinks) ? result.brokenLinks : []) {
        pushIssue(issues, {
            id: 'broken-link',
            category: 'links',
            severity: 'high',
            title: 'Broken link detected',
            details: brokenLink,
            metadata: { brokenLink },
        });
    }

    if (result?.structuredData) {
        for (const parseError of Array.isArray(result.structuredData.parseErrors) ? result.structuredData.parseErrors : []) {
            pushIssue(issues, {
                id: 'schema-errors',
                category: 'structured-data',
                severity: 'high',
                title: 'Structured data parse error',
                details: parseError,
                metadata: { parseError },
            });
        }

        for (const schemaIssue of Array.isArray(result.structuredData.issues) ? result.structuredData.issues : []) {
            pushIssue(issues, {
                id: schemaIssue.severity === 'error' ? 'schema-errors' : schemaIssue.severity === 'warning' ? 'schema-warnings' : 'schema-info',
                category: 'structured-data',
                severity: schemaIssue.severity === 'error' ? 'high' : schemaIssue.severity === 'warning' ? 'medium' : 'info',
                title: 'Structured data issue',
                details: schemaIssue.message || schemaIssue.code || 'Structured data issue',
                metadata: schemaIssue,
            });
        }
    }

    for (const strategy of ['mobile', 'desktop']) {
        const score = getPsiScore(result, strategy);
        if (score !== null && score < 90) {
            pushIssue(issues, {
                id: `slow-${strategy}`,
                category: 'performance',
                severity: score < 50 ? 'high' : 'medium',
                title: `${strategy === 'mobile' ? 'Mobile' : 'Desktop'} PageSpeed needs work`,
                details: `${strategy} performance score is ${score}.`,
                metadata: { strategy, score },
            });
        }
        addCoreWebVitalIssues(issues, result, strategy);
    }

    const incomingLinks = Number(result?.incomingLinks || 0);
    if (isIndexablePass(result) && incomingLinks === 0) {
        pushIssue(issues, {
            id: 'indexed-orphan',
            category: 'links',
            severity: 'medium',
            title: 'Indexed orphan page',
            details: 'The page is indexed but has no internal links from other audited pages.',
            metadata: { incomingLinks },
        });
    } else if (isIndexablePass(result) && incomingLinks <= 2 && (Number(result?.ga4_views || 0) > 0 || Number(result?.wordCount || 0) >= 800)) {
        pushIssue(issues, {
            id: 'high-value-underlinked',
            category: 'links',
            severity: 'low',
            title: 'High-value page is underlinked',
            details: 'The page has traffic or substantial content but weak internal link support.',
            metadata: { incomingLinks, ga4Views: result?.ga4_views || 0, wordCount: result?.wordCount || 0 },
        });
    }

    return issues.sort((left, right) => {
        const severityDelta = (ISSUE_SEVERITY_ORDER[right.severity] || 0) - (ISSUE_SEVERITY_ORDER[left.severity] || 0);
        return severityDelta || left.category.localeCompare(right.category) || left.id.localeCompare(right.id);
    });
}

function annotateTechnicalIssues(results) {
    const context = buildIssueContext(results);
    return (Array.isArray(results) ? results : []).map((result) => {
        result.technicalIssues = collectTechnicalIssues(result, context);
        return result;
    });
}

function summarizeIssues(results) {
    const summary = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        info: 0,
    };

    for (const result of Array.isArray(results) ? results : []) {
        for (const issue of Array.isArray(result?.technicalIssues) ? result.technicalIssues : collectTechnicalIssues(result)) {
            if (Object.prototype.hasOwnProperty.call(summary, issue.severity)) {
                summary[issue.severity] += 1;
            }
        }
    }

    return summary;
}

module.exports = {
    collectTechnicalIssues,
    annotateTechnicalIssues,
    summarizeIssues,
    __internal: {
        buildIssueContext,
        getDisplayNumber,
        parseMilliseconds,
        parseSeconds,
    },
};
