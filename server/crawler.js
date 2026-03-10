const { google } = require('googleapis');
const { getAuthClient } = require('./auth');
const gsc = require('./gsc');
const psi = require('./psi');
const { discoverSitemapUrls, isInternalUrl, normalizeUrl } = require('./siteDiscovery');

function getNumberEnv(name, fallback) {
    const parsed = Number(process.env[name] || fallback);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function isCoverageBroken(coverageState = '') {
    return /404|5xx|server error|redirect error|blocked/i.test(String(coverageState));
}

function createEmptyPageData(url) {
    const normalized = normalizeUrl(url) || url;
    return {
        title: '',
        description: '',
        canonicalUrl: '',
        metaRobots: '',
        lang: '',
        h1s: [],
        h2Count: 0,
        wordCount: 0,
        links: [],
        imageCount: 0,
        missingAltCount: 0,
        ogTitle: '',
        ogDescription: '',
        twitterCard: '',
        schemaCount: 0,
        httpStatus: 0,
        finalUrl: normalized,
    };
}

async function crawlSite(startUrl, maxPages = getNumberEnv('AUDIT_MAX_PAGES', 500)) {
    console.log('Starting GSC Index Audit + Live Crawl...');
    const auth = getAuthClient();
    if (!auth) {
        throw new Error('Google Auth missing. Please login again.');
    }

    let urlsToAudit = await discoverSitemapUrls(startUrl, { maxUrls: maxPages });
    if (urlsToAudit.length > maxPages) {
        urlsToAudit = urlsToAudit.slice(0, maxPages);
    }

    let gscSiteUrl = startUrl;
    try {
        const searchconsole = google.searchconsole({ version: 'v1', auth });
        const sitesRes = await searchconsole.sites.list({});
        const sites = sitesRes.data.siteEntry || [];

        const exactMatch = sites.find((site) => site.siteUrl === startUrl || site.siteUrl === `${startUrl}/`);
        const domainMatch = sites.find((site) => site.siteUrl.includes('sc-domain:') && startUrl.includes(site.siteUrl.replace('sc-domain:', '')));

        if (exactMatch) {
            gscSiteUrl = exactMatch.siteUrl;
        } else if (domainMatch) {
            gscSiteUrl = domainMatch.siteUrl;
        } else if (!gscSiteUrl.endsWith('/') && !gscSiteUrl.includes('sc-domain:')) {
            gscSiteUrl += '/';
        }
    } catch (e) {
        console.error('Failed to list sites:', e.message);
    }

    const pageImpressions = {};
    try {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 90);
        const ymd = (date) => date.toISOString().split('T')[0];

        const perfData = await gsc.getPerformance(gscSiteUrl, {
            startDate: ymd(start),
            endDate: ymd(end),
            dimensions: ['page'],
        });

        (perfData.rows || []).forEach((row) => {
            const page = row.keys?.[0];
            const normalizedPage = normalizeUrl(page);
            if (normalizedPage) {
                pageImpressions[normalizedPage] = (pageImpressions[normalizedPage] || 0) + (row.impressions || 0);
            }
        });
    } catch (e) {
        console.warn('Could not fetch performance data:', e.message);
    }

    urlsToAudit = urlsToAudit
        .map((url) => normalizeUrl(url) || url)
        .sort((a, b) => (pageImpressions[b] || 0) - (pageImpressions[a] || 0));

    const psiSampleSize = Math.min(urlsToAudit.length, getNumberEnv('AUDIT_PSI_SAMPLE_SIZE', 75));
    const psiPriorityUrls = new Set(urlsToAudit.slice(0, psiSampleSize));
    const results = [];

    const { launchBrowser } = require('./browser');
    console.log('Launching Headless Browser...');
    const browser = await launchBrowser();

    try {
        const batchSize = getNumberEnv('AUDIT_BATCH_SIZE', 4);
        for (let i = 0; i < urlsToAudit.length; i += batchSize) {
            const batch = urlsToAudit.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(urlsToAudit.length / batchSize)} (${batch.length} URLs)...`);

            await Promise.all(batch.map(async (url) => {
                const normalizedRequestedUrl = normalizeUrl(url) || url;
                const inspectPromise = gsc.inspectUrl(gscSiteUrl, url).then((res) => {
                    if (res.error) return { error: res.error };
                    return res.inspectionResult || {};
                });

                const crawlPromise = (async () => {
                    let pageData = createEmptyPageData(url);
                    let page = null;

                    try {
                        page = await browser.newPage();
                        await page.setRequestInterception(true);
                        page.on('request', (req) => {
                            if (['image', 'font', 'media'].includes(req.resourceType())) {
                                req.abort();
                                return;
                            }
                            req.continue();
                        });

                        const response = await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
                        pageData.httpStatus = response?.status() || 0;
                        pageData.finalUrl = normalizeUrl(page.url()) || normalizedRequestedUrl;

                        const extracted = await page.evaluate(() => {
                            const title = document.title.trim();
                            const description = document.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() || '';
                            const canonicalUrl = document.querySelector('link[rel="canonical"]')?.getAttribute('href')?.trim() || '';
                            const metaRobots = document.querySelector('meta[name="robots"], meta[name="googlebot"]')?.getAttribute('content')?.trim() || '';
                            const lang = document.documentElement.lang?.trim() || '';
                            const h1s = Array.from(document.querySelectorAll('h1'))
                                .map((el) => el.textContent?.trim() || '')
                                .filter(Boolean);
                            const h2Count = document.querySelectorAll('h2').length;
                            const bodyText = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
                            const wordCount = bodyText ? bodyText.split(' ').length : 0;
                            const links = Array.from(document.querySelectorAll('a[href]'))
                                .map((el) => el.getAttribute('href'))
                                .filter(Boolean)
                                .map((href) => new URL(href, window.location.href).href)
                                .filter((href) => href.startsWith('http'));
                            const images = Array.from(document.querySelectorAll('img'));
                            const missingAltCount = images.filter((img) => !(img.getAttribute('alt') || '').trim()).length;
                            const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() || '';
                            const ogDescription = document.querySelector('meta[property="og:description"]')?.getAttribute('content')?.trim() || '';
                            const twitterCard = document.querySelector('meta[name="twitter:card"]')?.getAttribute('content')?.trim() || '';
                            const schemaCount = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
                                .map((script) => script.textContent?.trim() || '')
                                .filter(Boolean)
                                .length;

                            return {
                                title,
                                description,
                                canonicalUrl,
                                metaRobots,
                                lang,
                                h1s,
                                h2Count,
                                wordCount,
                                links,
                                imageCount: images.length,
                                missingAltCount,
                                ogTitle,
                                ogDescription,
                                twitterCard,
                                schemaCount,
                            };
                        });

                        pageData = { ...pageData, ...extracted };
                    } catch (err) {
                        console.error(`Crawl failed for ${url}:`, err.message);
                    } finally {
                        if (page) {
                            await page.close();
                        }
                    }

                    return pageData;
                })();

                const [inspectionData, pageData] = await Promise.all([inspectPromise, crawlPromise]);
                const canonicalUrl = pageData.canonicalUrl
                    ? normalizeUrl(new URL(pageData.canonicalUrl, normalizedFinalUrl).href)
                    : '';
                const normalizedFinalUrl = normalizeUrl(pageData.finalUrl) || normalizedRequestedUrl;
                const metaRobots = (pageData.metaRobots || '').toLowerCase();
                const isNoindex = /(^|\s|,)noindex(\s|,|$)/.test(metaRobots);
                const isNofollow = /(^|\s|,)nofollow(\s|,|$)/.test(metaRobots);
                const internalLinks = unique((pageData.links || [])
                    .map((link) => normalizeUrl(link))
                    .filter(Boolean)
                    .filter((link) => isInternalUrl(link, startUrl)));
                const externalLinks = unique((pageData.links || [])
                    .map((link) => normalizeUrl(link, { keepQuery: true }) || link)
                    .filter(Boolean)
                    .filter((link) => !isInternalUrl(link, startUrl)));

                if (inspectionData.error) {
                    results.push({
                        url: normalizedRequestedUrl,
                        normalizedUrl: normalizedFinalUrl,
                        finalUrl: normalizedFinalUrl,
                        httpStatus: pageData.httpStatus || 0,
                        redirected: normalizedFinalUrl !== normalizedRequestedUrl,
                        status: 'ERROR',
                        coverageState: inspectionData.error,
                        indexingState: 'ERROR',
                        lastCrawlTime: '-',
                        robotStatus: '-',
                        psi_score: 0,
                        psi_data: null,
                        title: pageData.title,
                        description: pageData.description,
                        canonicalUrl,
                        canonicalIssue: !!canonicalUrl && canonicalUrl !== normalizedFinalUrl,
                        metaRobots: pageData.metaRobots,
                        isNoindex,
                        isNofollow,
                        lang: pageData.lang,
                        h1Count: pageData.h1s.length,
                        h2Count: pageData.h2Count,
                        wordCount: pageData.wordCount,
                        imageCount: pageData.imageCount,
                        missingAltCount: pageData.missingAltCount,
                        schemaCount: pageData.schemaCount,
                        hasOgTags: !!(pageData.ogTitle || pageData.ogDescription),
                        hasTwitterCard: !!pageData.twitterCard,
                        internalLinksOut: internalLinks.length,
                        externalLinksOut: externalLinks.length,
                        rawInternalLinks: internalLinks,
                        incomingLinks: 0,
                        crawlDepth: null,
                        isOrphan: false,
                        duplicateTitle: false,
                        duplicateDescription: false,
                        brokenLinks: [],
                        performanceSampled: false,
                    });
                    return;
                }

                const indexStatus = inspectionData.indexStatusResult || {};
                let robotStatus = indexStatus.robotsTxtState || '-';
                if (robotStatus === 'ROBOTS_TXT_STATE_UNSPECIFIED') robotStatus = 'Not Checked (Queued)';

                const impressions = pageImpressions[normalizedRequestedUrl] || pageImpressions[normalizedFinalUrl] || 0;
                let finalStatus = indexStatus.verdict || 'UNKNOWN';
                let finalCoverage = formatCoverageState(indexStatus.coverageState);

                if (impressions > 0) {
                    finalStatus = 'PASS';
                    finalCoverage = 'Indexed & Serving';
                } else if (finalStatus === 'PASS') {
                    finalCoverage = 'Indexed (Dormant)';
                }

                let psiData = null;
                const performanceSampled = psiPriorityUrls.has(normalizedRequestedUrl) || psiPriorityUrls.has(normalizedFinalUrl);
                if (performanceSampled) {
                    try {
                        console.log(`Running PSI for ${url}...`);
                        const rawPsi = await psi.getPSI(url);
                        const mobileScore = (rawPsi.mobile?.lighthouseResult?.categories?.performance?.score * 100) || 0;
                        const desktopScore = (rawPsi.desktop?.lighthouseResult?.categories?.performance?.score * 100) || 0;
                        psiData = {
                            mobile: {
                                score: Math.round(mobileScore),
                                lcp: rawPsi.mobile?.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue,
                                cls: rawPsi.mobile?.lighthouseResult?.audits?.['cumulative-layout-shift']?.displayValue,
                                inp: rawPsi.mobile?.lighthouseResult?.audits?.['interaction-to-next-paint']?.displayValue,
                            },
                            desktop: {
                                score: Math.round(desktopScore),
                                lcp: rawPsi.desktop?.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue,
                                cls: rawPsi.desktop?.lighthouseResult?.audits?.['cumulative-layout-shift']?.displayValue,
                                inp: rawPsi.desktop?.lighthouseResult?.audits?.['interaction-to-next-paint']?.displayValue,
                            },
                        };
                    } catch {
                        psiData = null;
                    }
                }

                results.push({
                    url: normalizedRequestedUrl,
                    normalizedUrl: normalizedFinalUrl,
                    finalUrl: normalizedFinalUrl,
                    httpStatus: pageData.httpStatus || 0,
                    redirected: normalizedFinalUrl !== normalizedRequestedUrl,
                    status: finalStatus,
                    coverageState: finalCoverage,
                    indexingState: indexStatus.indexingState || '-',
                    lastCrawlTime: indexStatus.lastCrawlTime ? new Date(indexStatus.lastCrawlTime).toLocaleString() : 'Never',
                    robotStatus,
                    psi_score: psiData?.mobile?.score || 0,
                    psi_data: psiData,
                    title: pageData.title,
                    description: pageData.description,
                    canonicalUrl,
                    canonicalIssue: !!canonicalUrl && canonicalUrl !== normalizedFinalUrl,
                    metaRobots: pageData.metaRobots,
                    isNoindex,
                    isNofollow,
                    lang: pageData.lang,
                    h1Count: pageData.h1s.length,
                    h2Count: pageData.h2Count,
                    wordCount: pageData.wordCount,
                    imageCount: pageData.imageCount,
                    missingAltCount: pageData.missingAltCount,
                    schemaCount: pageData.schemaCount,
                    hasOgTags: !!(pageData.ogTitle || pageData.ogDescription),
                    hasTwitterCard: !!pageData.twitterCard,
                    internalLinksOut: internalLinks.length,
                    externalLinksOut: externalLinks.length,
                    rawInternalLinks: internalLinks,
                    incomingLinks: 0,
                    crawlDepth: null,
                    isOrphan: false,
                    duplicateTitle: false,
                    duplicateDescription: false,
                    brokenLinks: [],
                    performanceSampled,
                });
            }));

            if (i + batchSize < urlsToAudit.length) {
                await new Promise((resolve) => setTimeout(resolve, 1500));
            }
        }

        console.log('Computing Link Graph...');

        const knownUrls = new Set(results.map((result) => result.normalizedUrl || normalizeUrl(result.url)).filter(Boolean));
        const resultsByUrl = new Map(results.map((result) => [result.normalizedUrl || normalizeUrl(result.url), result]));
        const incomingCounts = {};
        const adjacency = new Map();

        results.forEach((page) => {
            const sourceUrl = page.normalizedUrl || normalizeUrl(page.url);
            const matchedLinks = unique((page.rawInternalLinks || [])
                .map((link) => normalizeUrl(link))
                .filter((link) => knownUrls.has(link)));

            adjacency.set(sourceUrl, matchedLinks);
            matchedLinks.forEach((link) => {
                incomingCounts[link] = (incomingCounts[link] || 0) + 1;
            });

            page.internalLinksOut = matchedLinks.length;
            page.brokenLinks = matchedLinks.filter((link) => {
                const target = resultsByUrl.get(link);
                if (!target) return false;
                return (target.httpStatus || 0) >= 400 || isCoverageBroken(target.coverageState) || target.status === 'ERROR';
            });
            delete page.rawInternalLinks;
        });

        const titleCounts = {};
        const descriptionCounts = {};
        results.forEach((page) => {
            const normalizedTitle = (page.title || '').trim().toLowerCase();
            const normalizedDescription = (page.description || '').trim().toLowerCase();
            if (normalizedTitle) {
                titleCounts[normalizedTitle] = (titleCounts[normalizedTitle] || 0) + 1;
            }
            if (normalizedDescription) {
                descriptionCounts[normalizedDescription] = (descriptionCounts[normalizedDescription] || 0) + 1;
            }
        });

        const normalizedStartUrl = normalizeUrl(startUrl);
        const rootPage = results.find((page) => page.normalizedUrl === normalizedStartUrl)
            || results.find((page) => {
                try {
                    return new URL(page.normalizedUrl || page.url).pathname === '/';
                } catch {
                    return false;
                }
            })
            || results[0];

        const depthMap = new Map();
        if (rootPage?.normalizedUrl) {
            const queue = [rootPage.normalizedUrl];
            depthMap.set(rootPage.normalizedUrl, 0);

            while (queue.length) {
                const currentUrl = queue.shift();
                const currentDepth = depthMap.get(currentUrl) || 0;
                const nextLinks = adjacency.get(currentUrl) || [];
                nextLinks.forEach((link) => {
                    if (!depthMap.has(link)) {
                        depthMap.set(link, currentDepth + 1);
                        queue.push(link);
                    }
                });
            }
        }

        results.forEach((page) => {
            const normalizedUrl = page.normalizedUrl || normalizeUrl(page.url);
            page.incomingLinks = incomingCounts[normalizedUrl] || 0;
            page.crawlDepth = depthMap.has(normalizedUrl) ? depthMap.get(normalizedUrl) : null;
            page.isOrphan = page.incomingLinks === 0 && page.crawlDepth !== 0;

            const normalizedTitle = (page.title || '').trim().toLowerCase();
            const normalizedDescription = (page.description || '').trim().toLowerCase();
            page.duplicateTitle = !!normalizedTitle && titleCounts[normalizedTitle] > 1;
            page.duplicateDescription = !!normalizedDescription && descriptionCounts[normalizedDescription] > 1;
        });
    } finally {
        await browser.close();
    }

    return results.sort((a, b) => a.url.localeCompare(b.url));
}

function formatCoverageState(state) {
    if (!state) return 'Unknown';
    const map = {
        SUBMITTED_AND_INDEXED: 'Submitted and indexed',
        CRAWLED_NOT_INDEXED: 'Crawled - currently not indexed',
        DISCOVERED_NOT_INDEXED: 'Discovered - currently not indexed',
        INDEXING_STATE_UNSPECIFIED: 'Unknown',
        BLOCKED_BY_ROBOTS_TXT: 'Blocked by robots.txt',
        NOT_FOUND: 'Page not found (404)',
        SERVER_ERROR: 'Server error (5xx)',
        REDIRECT_ERROR: 'Redirect error',
        BLOCKED_4XX: 'Blocked (4xx)',
        DUPLICATE_WITHOUT_USER_SELECTED_CANONICAL: 'Duplicate without user-selected canonical',
        DUPLICATE_GOOGLE_CHOSE_DIFFERENT_CANONICAL: 'Duplicate, Google chose different canonical than user',
        SOFT_404: 'Soft 404',
    };
    return map[state] || state;
}

module.exports = { crawlSite };

