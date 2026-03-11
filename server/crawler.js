const { google } = require('googleapis');
const { getAuthClient } = require('./auth');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const gsc = require('./gsc');
const psi = require('./psi');

const fetchSitemapUrls = async (siteUrl) => {
    try {
        const sitemapUrl = new URL('/sitemap.xml', siteUrl).href;
        console.log(`Fetching sitemap: ${sitemapUrl}`);

        const response = await axios.get(sitemapUrl, { timeout: 10000 });
        const $ = cheerio.load(response.data, { xmlMode: true });
        const urls = [];

        $('loc').each((i, el) => {
            const url = $(el).text().trim();
            if (url) urls.push(url);
        });

        const pageUrls = urls.filter((url) => !url.endsWith('.xml'));
        console.log(`Found ${pageUrls.length} URLs in sitemap.`);
        return pageUrls;
    } catch (e) {
        console.error('Failed to fetch sitemap:', e.message);
        return [siteUrl];
    }
};

function getCrawlOptions(options) {
    if (typeof options === 'number') {
        return { maxPages: options, onProgress: null };
    }

    return {
        maxPages: Number(options?.maxPages || 200),
        onProgress: typeof options?.onProgress === 'function' ? options.onProgress : null,
    };
}

async function reportProgress(onProgress, payload) {
    if (!onProgress) {
        return;
    }

    await onProgress({
        stage: payload.stage,
        completed: payload.completed,
        total: payload.total,
        percent: payload.total > 0 ? Math.min(100, Math.round((payload.completed / payload.total) * 100)) : payload.percent || 0,
        message: payload.message,
        currentUrl: payload.currentUrl || '',
    });
}

const crawlSite = async (startUrl, options = {}) => {
    const { maxPages, onProgress } = getCrawlOptions(options);
    console.log('Starting GSC Index Audit + Live Crawl...');
    const auth = getAuthClient();
    if (!auth) {
        throw new Error('Google Auth missing. Please login again.');
    }

    await reportProgress(onProgress, {
        stage: 'Loading sitemap',
        completed: 0,
        total: 0,
        percent: 0,
        message: 'Loading sitemap URLs',
    });

    let urlsToAudit = await fetchSitemapUrls(startUrl);
    if (urlsToAudit.length > maxPages) {
        urlsToAudit = urlsToAudit.slice(0, maxPages);
    }

    await reportProgress(onProgress, {
        stage: 'Preparing crawl',
        completed: 0,
        total: urlsToAudit.length,
        percent: 0,
        message: `Preparing ${urlsToAudit.length} URLs for crawling`,
    });

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
            const page = row.keys[0];
            if (page) {
                const normalizedPage = page.replace(/\/$/, '');
                pageImpressions[normalizedPage] = (pageImpressions[normalizedPage] || 0) + (row.impressions || 0);
            }
        });
    } catch (e) {
        console.warn('Could not fetch performance data:', e.message);
    }

    const results = [];
    const { launchBrowser } = require('./browser');
    console.log('Launching Headless Browser...');
    const browser = await launchBrowser();
    let processedCount = 0;
    const totalCount = urlsToAudit.length;

    try {
        const batchSize = 3;
        for (let i = 0; i < urlsToAudit.length; i += batchSize) {
            const batch = urlsToAudit.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(urlsToAudit.length / batchSize)} (${batch.length} URLs)...`);

            await Promise.all(batch.map(async (url) => {
                const inspectPromise = gsc.inspectUrl(gscSiteUrl, url).then((res) => {
                    if (res.error) return { error: res.error };
                    return res.inspectionResult || {};
                });

                const crawlPromise = (async () => {
                    let pageData = { title: '', description: '', h1s: [], wordCount: 0, links: [] };
                    let page = null;
                    try {
                        page = await browser.newPage();
                        await page.setRequestInterception(true);
                        page.on('request', (req) => {
                            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
                            else req.continue();
                        });

                        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
                        pageData = await page.evaluate(() => {
                            const title = document.title;
                            const description = document.querySelector('meta[name="description"]')?.content || '';
                            const h1s = Array.from(document.querySelectorAll('h1')).map((el) => el.textContent.trim());
                            const bodyText = document.body.innerText || '';
                            const wordCount = bodyText.split(/\s+/).length;
                            const links = Array.from(document.querySelectorAll('a')).map((anchor) => anchor.href).filter((href) => href.startsWith('http'));
                            return { title, description, h1s, wordCount, links };
                        });
                    } catch (err) {
                        console.error(`Crawl failed for ${url}:`, err.message);
                    } finally {
                        if (page) await page.close();
                    }
                    return pageData;
                })();

                const [inspectionData, pageData] = await Promise.all([inspectPromise, crawlPromise]);

                if (inspectionData.error) {
                    results.push({
                        url,
                        status: 'FAIL',
                        coverageState: inspectionData.error,
                        indexingState: 'ERROR',
                        lastCrawlTime: '-',
                        title: pageData.title,
                        description: pageData.description,
                        h1Count: pageData.h1s?.length || 0,
                        wordCount: pageData.wordCount || 0,
                        internalLinksOut: 0,
                        externalLinksOut: 0,
                        incomingLinks: 0,
                        brokenLinks: [],
                    });
                } else {
                    const indexStatus = inspectionData.indexStatusResult || {};
                    let robotStatus = indexStatus.robotsTxtState || '-';
                    if (robotStatus === 'ROBOTS_TXT_STATE_UNSPECIFIED') robotStatus = 'Not Checked (Queued)';

                    const normalizedUrl = url.replace(/\/$/, '');
                    const impressions = pageImpressions[normalizedUrl] || 0;
                    let finalStatus = indexStatus.verdict || 'UNKNOWN';
                    let finalCoverage = formatCoverageState(indexStatus.coverageState);

                    if (impressions > 0) {
                        finalStatus = 'PASS';
                        finalCoverage = 'Indexed & Serving';
                    } else if (finalStatus === 'PASS') {
                        finalCoverage = 'Indexed (Dormant)';
                    }

                    let psiData = null;
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

                    const domain = new URL(startUrl).hostname;
                    const internalLinks = (pageData.links || []).filter((link) => link.includes(domain));
                    const externalLinks = (pageData.links || []).filter((link) => !link.includes(domain));

                    results.push({
                        url,
                        status: finalStatus,
                        coverageState: finalCoverage,
                        indexingState: indexStatus.indexingState || '-',
                        lastCrawlTime: indexStatus.lastCrawlTime ? new Date(indexStatus.lastCrawlTime).toLocaleString() : 'Never',
                        robotStatus,
                        psi_score: psiData?.mobile?.score || 0,
                        psi_data: psiData,
                        title: pageData.title,
                        description: pageData.description,
                        h1Count: pageData.h1s.length,
                        wordCount: pageData.wordCount,
                        internalLinksOut: internalLinks.length,
                        externalLinksOut: externalLinks.length,
                        rawInternalLinks: internalLinks,
                        incomingLinks: 0,
                        brokenLinks: [],
                    });
                }

                processedCount += 1;
                await reportProgress(onProgress, {
                    stage: 'Crawling pages',
                    completed: processedCount,
                    total: totalCount,
                    message: `Processed ${processedCount} of ${totalCount} pages`,
                    currentUrl: url,
                });
            }));

            if (i + batchSize < urlsToAudit.length) {
                await new Promise((resolve) => setTimeout(resolve, 2000));
            }
        }

        await reportProgress(onProgress, {
            stage: 'Analyzing internal links',
            completed: totalCount,
            total: totalCount,
            percent: 95,
            message: 'Building internal link graph',
        });

        const urlInLinks = {};
        const knownUrls = new Set(results.map((result) => result.url));

        results.forEach((page) => {
            if (page.rawInternalLinks) {
                page.rawInternalLinks.forEach((link) => {
                    if (knownUrls.has(link)) {
                        urlInLinks[link] = (urlInLinks[link] || 0) + 1;
                    }
                });
            }
        });

        results.forEach((page) => {
            page.incomingLinks = urlInLinks[page.url] || 0;
            delete page.rawInternalLinks;
        });
    } finally {
        await browser.close();
    }

    results.sort((a, b) => a.url.localeCompare(b.url));

    await reportProgress(onProgress, {
        stage: 'Completed',
        completed: totalCount,
        total: totalCount,
        percent: 100,
        message: `Completed audit for ${totalCount} pages`,
    });

    return results;
};

const formatCoverageState = (state) => {
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
};

module.exports = { crawlSite };
