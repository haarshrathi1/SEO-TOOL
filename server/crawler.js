const { google } = require('googleapis');
const { getAuthClient } = require('./auth');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const gsc = require('./gsc');
const ga4 = require('./ga4');
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

        const pageUrls = urls.filter(u => !u.endsWith('.xml'));
        console.log(`Found ${pageUrls.length} URLs in sitemap.`);
        return pageUrls;

    } catch (e) {
        console.error('Failed to fetch sitemap:', e.message);
        return [siteUrl];
    }
};

// inspectUrl removed - using gsc.inspectUrl instead

const crawlSite = async (startUrl, maxPages = 200) => {
    console.log('Starting GSC Index Audit + Live Crawl...');
    const auth = getAuthClient();
    if (!auth) {
        throw new Error('Google Auth missing. Please login again.');
    }

    // 1. Get URLs
    let urlsToAudit = await fetchSitemapUrls(startUrl);
    if (urlsToAudit.length > maxPages) {
        urlsToAudit = urlsToAudit.slice(0, maxPages);
    }

    // Dynamic Site Matching (GSC)
    let gscSiteUrl = startUrl;
    try {
        const searchconsole = google.searchconsole({ version: 'v1', auth });
        const sitesRes = await searchconsole.sites.list({});
        const sites = sitesRes.data.siteEntry || [];

        const exactMatch = sites.find(s => s.siteUrl === startUrl || s.siteUrl === startUrl + '/');
        const domainMatch = sites.find(s => s.siteUrl.includes('sc-domain:') && startUrl.includes(s.siteUrl.replace('sc-domain:', '')));

        if (exactMatch) {
            gscSiteUrl = exactMatch.siteUrl;
        } else if (domainMatch) {
            gscSiteUrl = domainMatch.siteUrl;
        } else {
            if (!gscSiteUrl.endsWith('/') && !gscSiteUrl.includes('sc-domain:')) {
                gscSiteUrl += '/';
            }
        }
    } catch (e) {
        console.error('Failed to list sites:', e.message);
    }

    // 1b. Fetch Performance Data (Impressions)
    let pageImpressions = {};
    try {
        const end = new Date();
        const start = new Date();
        start.setDate(end.getDate() - 90);
        const ymd = d => d.toISOString().split('T')[0];

        const perfData = await gsc.getPerformance(gscSiteUrl, {
            startDate: ymd(start),
            endDate: ymd(end),
            dimensions: ['page']
        });

        (perfData.rows || []).forEach(row => {
            const p = row.keys[0];
            if (p) {
                const normP = p.replace(/\/$/, '');
                pageImpressions[normP] = (pageImpressions[normP] || 0) + (row.impressions || 0);
            }
        });
    } catch (e) {
        console.warn('Could not fetch performance data:', e.message);
    }

    const results = [];

    // ---------------------------------------------------------
    // PUPPETEER SETUP for React/SPA Crawling
    // ---------------------------------------------------------
    const { launchBrowser } = require('./browser');
    console.log('Launching Headless Browser...');
    const browser = await launchBrowser();

    try {
        const batchSize = 3; // Keep low for memory usage
        for (let i = 0; i < urlsToAudit.length; i += batchSize) {
            const batch = urlsToAudit.slice(i, i + batchSize);
            console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(urlsToAudit.length / batchSize)} (${batch.length} URLs)...`);

            await Promise.all(batch.map(async (url) => {
                // A. GOOGLE INSPECTION
                const inspectPromise = gsc.inspectUrl(gscSiteUrl, url).then(res => {
                    if (res.error) return { error: res.error };
                    return res.inspectionResult || {};
                });

                // B. LIVE CRAWL (Puppeteer)
                const crawlPromise = (async () => {
                    let pageData = { title: '', description: '', h1s: [], wordCount: 0 };
                    let page = null;
                    try {
                        page = await browser.newPage();
                        // Block images/css to speed up
                        await page.setRequestInterception(true);
                        page.on('request', (req) => {
                            if (['image', 'stylesheet', 'font'].includes(req.resourceType())) req.abort();
                            else req.continue();
                        });

                        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

                        // Extract Metas & Links
                        pageData = await page.evaluate(() => {
                            const title = document.title;
                            const description = document.querySelector('meta[name="description"]')?.content || '';
                            const h1s = Array.from(document.querySelectorAll('h1')).map(el => el.textContent.trim());
                            const bodyText = document.body.innerText || '';
                            const wordCount = bodyText.split(/\s+/).length;

                            // Link Extraction
                            const links = Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => h.startsWith('http'));

                            return { title, description, h1s, wordCount, links };
                        });

                    } catch (err) {
                        console.error(`Crawl failed for ${url}:`, err.message);
                    } finally {
                        if (page) await page.close();
                    }
                    return pageData;
                })();

                // Wait for both
                const [inspectionData, pageData] = await Promise.all([inspectPromise, crawlPromise]);

                // Handle Inspection Errors
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
                        brokenLinks: []
                    });
                    return;
                }

                const indexStatus = inspectionData.indexStatusResult || {};
                let robotStatus = indexStatus.robotsTxtState || '-';
                if (robotStatus === 'ROBOTS_TXT_STATE_UNSPECIFIED') robotStatus = 'Not Checked (Queued)';

                // Status Logic
                const normUrl = url.replace(/\/$/, '');
                const imps = pageImpressions[normUrl] || 0;
                let finalStatus = indexStatus.verdict || 'UNKNOWN';
                let finalCoverage = formatCoverageState(indexStatus.coverageState);

                if (imps > 0) {
                    finalStatus = 'PASS';
                    finalCoverage = 'Indexed & Serving';
                } else if (finalStatus === 'PASS') {
                    finalCoverage = 'Indexed (Dormant)';
                }

                // C. PSI (Sample or Full)
                let psiData = null;
                try {
                    // Only run PSI if crawling succeeded to save time/quota, or run always
                    console.log(`Running PSI for ${url}...`);
                    const rawPsi = await psi.getPSI(url);
                    const mobileScore = (rawPsi.mobile?.lighthouseResult?.categories?.performance?.score * 100) || 0;
                    const desktopScore = (rawPsi.desktop?.lighthouseResult?.categories?.performance?.score * 100) || 0;
                    psiData = {
                        mobile: {
                            score: Math.round(mobileScore),
                            lcp: rawPsi.mobile?.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue,
                            cls: rawPsi.mobile?.lighthouseResult?.audits?.['cumulative-layout-shift']?.displayValue,
                            inp: rawPsi.mobile?.lighthouseResult?.audits?.['interaction-to-next-paint']?.displayValue
                        },
                        desktop: {
                            score: Math.round(desktopScore),
                            lcp: rawPsi.desktop?.lighthouseResult?.audits?.['largest-contentful-paint']?.displayValue,
                            cls: rawPsi.desktop?.lighthouseResult?.audits?.['cumulative-layout-shift']?.displayValue,
                            inp: rawPsi.desktop?.lighthouseResult?.audits?.['interaction-to-next-paint']?.displayValue
                        }
                    };
                } catch (e) {
                    // console.error('PSI Fail', e.message); 
                }

                // Process Links for this page
                const domain = new URL(startUrl).hostname;
                const internalLinks = (pageData.links || []).filter(l => l.includes(domain));
                const externalLinks = (pageData.links || []).filter(l => !l.includes(domain));

                results.push({
                    url: url,
                    status: finalStatus,
                    coverageState: finalCoverage,
                    indexingState: indexStatus.indexingState || '-',
                    lastCrawlTime: indexStatus.lastCrawlTime ? new Date(indexStatus.lastCrawlTime).toLocaleString() : 'Never',
                    robotStatus: robotStatus,
                    psi_score: psiData?.mobile?.score || 0,
                    psi_data: psiData,
                    // NEW METADATA
                    title: pageData.title,
                    description: pageData.description,
                    h1Count: pageData.h1s.length,
                    wordCount: pageData.wordCount,
                    // Link Data placeholders (computed after)
                    internalLinksOut: internalLinks.length,
                    externalLinksOut: externalLinks.length,
                    rawInternalLinks: internalLinks, // Temporary for post-processing
                    incomingLinks: 0,
                    brokenLinks: []
                });
            }));

            // Gentle delay for PSI/GSC limits
            if (i + batchSize < urlsToAudit.length) {
                await new Promise(r => setTimeout(r, 2000));
            }
        }

        // ---------------------------------------------------------
        // POST-CRAWL LINK ANALYSIS
        // ---------------------------------------------------------
        console.log('Computing Link Graph...');

        // 1. Build Incoming Link Map
        const urlInLinks = {};
        const knownUrls = new Set(results.map(r => r.url));

        results.forEach(page => {
            if (page.rawInternalLinks) {
                page.rawInternalLinks.forEach(link => {
                    // Normalize link slightly to match results
                    // A simple check: does 'link' equal any 'result.url'?
                    // Or more robust: check if 'link' is IN the 'knownUrls' set
                    // We can also track broken links here if 'link' is 404 in our crawl? 
                    // (But we only crawled sitemap URLs, so we might not know status of ALL internal links)

                    if (knownUrls.has(link)) {
                        urlInLinks[link] = (urlInLinks[link] || 0) + 1;
                    }
                });
            }
        });

        // 2. Assign Incoming Counts & Cleanup
        results.forEach(page => {
            page.incomingLinks = urlInLinks[page.url] || 0;
            delete page.rawInternalLinks; // remove heavy array
        });

    } finally {
        await browser.close();
    }

    return results;
};

const formatCoverageState = (state) => {
    if (!state) return 'Unknown';
    const map = {
        'SUBMITTED_AND_INDEXED': 'Submitted and indexed',
        'CRAWLED_NOT_INDEXED': 'Crawled - currently not indexed',
        'DISCOVERED_NOT_INDEXED': 'Discovered - currently not indexed',
        'INDEXING_STATE_UNSPECIFIED': 'Unknown',
        'BLOCKED_BY_ROBOTS_TXT': 'Blocked by robots.txt',
        'NOT_FOUND': 'Page not found (404)',
        'SERVER_ERROR': 'Server error (5xx)',
        'REDIRECT_ERROR': 'Redirect error',
        'BLOCKED_4XX': 'Blocked (4xx)',
        'DUPLICATE_WITHOUT_USER_SELECTED_CANONICAL': 'Duplicate without user-selected canonical',
        'DUPLICATE_GOOGLE_CHOSE_DIFFERENT_CANONICAL': 'Duplicate, Google chose different canonical than user',
        'SOFT_404': 'Soft 404'
    };
    return map[state] || state;
};

module.exports = { crawlSite };

