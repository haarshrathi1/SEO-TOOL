const { google } = require('googleapis');
const { getAuthClient } = require('./auth');
const gsc = require('./gsc');
const ga4 = require('./ga4');
const psi = require('./psi');
const history = require('./history');
const sheets = require('./sheets');
const { discoverSitemapUrls, normalizeUrl } = require('./siteDiscovery');
const { getProject } = require('./projects');

function getNumberEnv(name, fallback) {
    const parsed = Number(process.env[name] || fallback);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

async function resolveGscSiteUrl(siteUrl) {
    const auth = getAuthClient();
    if (!auth) {
        return siteUrl;
    }

    try {
        const searchconsole = google.searchconsole({ version: 'v1', auth });
        const sitesRes = await searchconsole.sites.list({});
        const sites = sitesRes.data.siteEntry || [];
        const exactMatch = sites.find((site) => site.siteUrl === siteUrl || site.siteUrl === `${siteUrl}/`);
        const domainMatch = sites.find((site) => site.siteUrl.includes('sc-domain:') && siteUrl.includes(site.siteUrl.replace('sc-domain:', '')));

        if (exactMatch) {
            return exactMatch.siteUrl;
        }
        if (domainMatch) {
            return domainMatch.siteUrl;
        }
    } catch (error) {
        console.error('Failed to resolve GSC property:', error.message);
    }

    return siteUrl.endsWith('/') || siteUrl.includes('sc-domain:') ? siteUrl : `${siteUrl}/`;
}

async function mapWithConcurrency(items, limit, mapper) {
    const results = [];
    for (let i = 0; i < items.length; i += limit) {
        const chunk = items.slice(i, i + limit);
        const chunkResults = await Promise.all(chunk.map(mapper));
        results.push(...chunkResults);
    }
    return results;
}

const analyzeSite = async (req, res) => {
    try {
        const projectId = req.query.projectId;
        const project = getProject(projectId);

        const siteUrl = project.url;
        const ga4PropertyId = project.ga4PropertyId;
        const gscSiteUrl = await resolveGscSiteUrl(siteUrl);

        console.log('Fetching GSC Performance (Query/Page)...');
        const performance = await gsc.getPerformance(gscSiteUrl);
        const rows = performance.rows || [];

        console.log('Fetching GSC Site Totals...');
        const siteTotals = await gsc.getSiteTotals(gscSiteUrl);

        const impressions = siteTotals.impressions;
        const clicks = siteTotals.clicks;
        const ctr = siteTotals.ctr;
        const avgPosition = siteTotals.avgPosition;
        const visibility = ctr;

        const keywordStats = {};
        const pages = {};
        const pageMetrics = {};

        rows.forEach((row) => {
            const imp = row.impressions || 0;
            const clk = row.clicks || 0;
            const keyword = row.keys?.[0];
            const page = row.keys?.[1];
            const normalizedPage = normalizeUrl(page);

            if (keyword) {
                if (!keywordStats[keyword]) keywordStats[keyword] = { imp: 0, clk: 0 };
                keywordStats[keyword].imp += imp;
                keywordStats[keyword].clk += clk;
            }

            if (page) {
                if (!pages[page]) pages[page] = { imp: 0, clk: 0 };
                pages[page].imp += imp;
                pages[page].clk += clk;
            }

            if (normalizedPage) {
                if (!pageMetrics[normalizedPage]) pageMetrics[normalizedPage] = { imp: 0, clk: 0 };
                pageMetrics[normalizedPage].imp += imp;
                pageMetrics[normalizedPage].clk += clk;
            }
        });

        const topKeywordsArr = Object.entries(keywordStats)
            .sort((a, b) => b[1].clk - a[1].clk)
            .slice(0, 5);

        const topKeywordsList = topKeywordsArr.map((entry) => entry[0]).join(', ');
        const structuredTopKeywords = topKeywordsArr.map(([keyword, metrics]) => ({
            keyword,
            impressions: metrics.imp,
            clicks: metrics.clk,
        }));

        const topPagesArr = Object.entries(pages).sort((a, b) => b[1].imp - a[1].imp).slice(0, 5);
        const topPagesList = topPagesArr.map(([url, metrics]) => `${url} (${metrics.imp} imp | ${metrics.clk} clicks)`).join(' | ');

        console.log('Discovering sitemap URLs for inspection...');
        const discoveredUrls = await discoverSitemapUrls(siteUrl, {
            maxUrls: getNumberEnv('ANALYZE_DISCOVERY_LIMIT', 500),
        });

        const inspectionLimit = Math.min(discoveredUrls.length, getNumberEnv('ANALYZE_INSPECTION_LIMIT', 50));
        const inspectionConcurrency = getNumberEnv('ANALYZE_INSPECTION_CONCURRENCY', 5);
        const urlsToInspect = [...discoveredUrls]
            .sort((a, b) => (pageMetrics[b]?.imp || 0) - (pageMetrics[a]?.imp || 0))
            .slice(0, inspectionLimit);

        console.log(`Inspecting ${urlsToInspect.length}/${discoveredUrls.length} URLs...`);
        const exactErrorsMap = {};
        const failedUrls = [];

        const inspectionResults = await mapWithConcurrency(urlsToInspect, inspectionConcurrency, async (url) => {
            const result = await gsc.inspectUrl(gscSiteUrl, url);
            const indexStatus = result?.inspectionResult?.indexStatusResult;
            const hasError = !indexStatus || indexStatus.verdict !== 'PASS' || indexStatus.robotsTxtState === 'BLOCKED' || indexStatus.indexingState === 'BLOCKED';
            return {
                url,
                hasError,
                reason: indexStatus?.coverageState || 'Unknown',
            };
        });

        inspectionResults.forEach((inspection) => {
            if (!inspection.hasError) {
                return;
            }

            exactErrorsMap[inspection.reason] = (exactErrorsMap[inspection.reason] || 0) + 1;
            failedUrls.push({ url: inspection.url, reason: inspection.reason });
        });

        const errors = failedUrls.length;
        const exactErrors = Object.entries(exactErrorsMap).map(([key, value]) => `${key} (${value})`).join(', ');

        console.log('Fetching GA4 Data...');
        let gaResult = { engagementRate: '0', averageSessionDuration: '0' };
        try {
            gaResult = await ga4.getGA4Data(ga4PropertyId);
        } catch (e) {
            console.error('GA4 Error:', e.message);
        }

        let formattedDuration = '0:00';
        if (gaResult.averageSessionDuration) {
            const totalSeconds = Math.floor(Number(gaResult.averageSessionDuration));
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        const engagementRatePercent = (parseFloat(gaResult.engagementRate || 0) * 100).toFixed(2);

        console.log('Running PageSpeed Insights...');
        const psiResult = await psi.getPSI(siteUrl);
        const psiMobileScore = psiResult.mobile?.lighthouseResult?.categories?.performance?.score * 100 || 0;
        const psiDesktopScore = psiResult.desktop?.lighthouseResult?.categories?.performance?.score * 100 || 0;

        const desktopAudits = psiResult.desktop?.lighthouseResult?.audits || {};
        const lcpDesktop = desktopAudits['largest-contentful-paint']?.displayValue || 'N/A';
        const clsDesktop = desktopAudits['cumulative-layout-shift']?.displayValue || 'N/A';
        const inpDesktop = desktopAudits['interaction-to-next-paint']?.displayValue || 'N/A';

        const mobileAudits = psiResult.mobile?.lighthouseResult?.audits || {};
        const lcpMobile = mobileAudits['largest-contentful-paint']?.displayValue || 'N/A';
        const clsMobile = mobileAudits['cumulative-layout-shift']?.displayValue || 'N/A';
        const inpMobile = mobileAudits['interaction-to-next-paint']?.displayValue || 'N/A';

        let psiWarnings = 0;
        let psiNotices = 0;
        Object.values(desktopAudits).forEach((audit) => {
            if (audit.score > 0 && audit.score < 1) psiWarnings++;
            else if (audit.scoreDisplayMode === 'informative') psiNotices++;
        });

        let score = 100;
        score -= Math.min(errors * 1.2, 40);
        score -= Math.min(psiWarnings * 0.7, 20);
        score -= Math.min(psiNotices * 0.2, 10);

        let cwvPenalty = 0;
        if (parseFloat(lcpDesktop) > 2.5) cwvPenalty += 8;
        if (parseFloat(clsDesktop) > 0.1) cwvPenalty += 6;
        score -= Math.min(cwvPenalty, 15);
        score = Math.max(5, Math.round(score));

        let status = 'Green';
        if (score < 45) status = 'Red';
        else if (score < 75) status = 'Orange';

        const structuredTopPages = Object.entries(pages)
            .sort((a, b) => b[1].clk - a[1].clk)
            .slice(0, 5)
            .map(([url, metrics]) => ({
                url,
                impressions: metrics.imp,
                clicks: metrics.clk,
            }));

        const alerts = [];
        if (clicks < 20) alerts.push('Low clicks');
        if (parseFloat(ctr) < 2) alerts.push('Low CTR');
        if (discoveredUrls.length > urlsToInspect.length) alerts.push('Sampled indexing inspection');

        const projectName = project.name;
        const domain = project.domain;

        const finalResponse = {
            week: performance.dateRange.weekLabel,
            project: projectName,
            domain,
            metrics: {
                clicks,
                impressions,
                ctr: `${ctr}%`,
                visibility: `${visibility}%`,
                avgPosition,
                engagementRate: `${engagementRatePercent}%`,
                avgSessionDuration: formattedDuration,
                psiMobile: Math.round(psiMobileScore),
                psiDesktop: Math.round(psiDesktopScore),
                lcpDesktop,
                clsDesktop,
                inpDesktop,
                lcpMobile,
                clsMobile,
                inpMobile,
            },
            issues: {
                errors,
                indexingWarnings: 0,
                psiWarnings,
                psiNotices,
                exactErrors,
                failedUrls,
                discoveredUrls: discoveredUrls.length,
                inspectedUrls: urlsToInspect.length,
                inspectionMode: discoveredUrls.length > urlsToInspect.length ? 'sampled' : 'full',
            },
            keywords: {
                count: Object.keys(keywordStats).length,
                top: structuredTopKeywords,
            },
            pages: {
                top: structuredTopPages,
            },
            health: {
                score,
                status,
                alerts,
            },
            report: {
                Week: performance.dateRange.weekLabel,
                Project: projectName,
                Domain: domain,
                Impressions: impressions,
                CTR: `${ctr}%`,
                AvgPosition: avgPosition,
                Visibility: `${visibility}%`,
                EngagementRate: `${engagementRatePercent}%`,
                AvgSessionDuration: formattedDuration,
                PSI_Mobile: Math.round(psiMobileScore),
                PSI_Desktop: Math.round(psiDesktopScore),
                LCP_Desktop: lcpDesktop,
                CLS_Desktop: clsDesktop,
                INP_Desktop: inpDesktop,
                LCP_Mobile: lcpMobile,
                CLS_Mobile: clsMobile,
                INP_Mobile: inpMobile,
                Errors: errors,
                Exact_Errors: exactErrors,
                PSI_Warnings: psiWarnings,
                PSI_Notices: psiNotices,
                KeywordCount: Object.keys(keywordStats).length,
                TopKeywords: topKeywordsList,
                Top_Page: topPagesList,
                Site_Health_Score: score,
                SEO_Status: status,
                Sitemap_URLs_Discovered: discoveredUrls.length,
                URLs_Inspected: urlsToInspect.length,
                Inspection_Mode: discoveredUrls.length > urlsToInspect.length ? 'sampled' : 'full',
            },
        };

        await history.addToHistory(finalResponse, project.id);

        let sheetStatus = false;
        let spreadsheetUrl = null;
        if (project.spreadsheetId) {
            console.log('Exporting to Google Sheets...');
            sheetStatus = await sheets.appendRow(project.spreadsheetId, project.sheetGid, finalResponse.report);
            spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${project.spreadsheetId}/edit#gid=${project.sheetGid}`;
        }

        res.json({ ...finalResponse, sheetStatus, spreadsheetUrl });
    } catch (e) {
        console.error('Analysis failed', e);
        const statusCode = e?.response?.status || e?.code;
        const errorReason =
            e?.errors?.[0]?.reason ||
            e?.response?.data?.error?.errors?.[0]?.reason ||
            e?.response?.data?.error?.status ||
            '';
        if (statusCode === 403 || String(e?.message || '').includes('403')) {
            if (errorReason === 'insufficientPermissions' || errorReason === 'PERMISSION_DENIED') {
                res.status(403).json({
                    error: 'Google account is authenticated but lacks required Search Console/GA4 permissions. Re-auth via /auth/google/login with the correct Google account and ensure it has access to the selected properties.',
                });
                return;
            }
            res.status(403).json({
                error: 'Google API access denied. Ensure APIs are enabled and the authenticated account has permission to this property.',
            });
            return;
        }
        res.status(500).json({ error: e.message });
    }
};

module.exports = { analyzeSite };
