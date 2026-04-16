const { google } = require('googleapis');
const gsc = require('./gsc');
const ga4 = require('./ga4');
const psi = require('./psi');
const utils = require('./utils');
const history = require('./history');
const sheets = require('./sheets');
const { fetchSitemapUrls } = require('./sitemaps');
const auth = require('./auth');

const { getProject } = require('./projects');

const analyzeSite = async (req, res) => {
    try {
        const projectId = req.query.projectId;
        const project = await getProject(projectId, req.user);

        if (!project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const authClient = await auth.getProjectAuthClient(project);
        if (!authClient) {
            return res.status(401).json({ error: 'Google service not authenticated for this project. Connect Google from the project setup page first.' });
        }

        const siteUrl = project.gscSiteUrl || project.url;
        const ga4PropertyId = project.ga4PropertyId;

        // 1. GSC Performance (for Lists)
        console.log('Fetching GSC Performance (Query/Page)...');
        const performance = await gsc.getPerformance(siteUrl, { authClient });
        const rows = performance.rows || [];

        // 1b. GSC Totals (Date dimension - Authoritative)
        console.log('Fetching GSC Site Totals...');
        const siteTotals = await gsc.getSiteTotals(siteUrl, { authClient });

        // Use authoritative totals for main metrics
        const impressions = siteTotals.impressions;
        const clicks = siteTotals.clicks;
        const ctr = siteTotals.ctr;
        const avgPosition = siteTotals.avgPosition;
        const visibility = ctr; // As per n8n logic

        // Aggregate rows ONLY for Top Lists (Keywords/Pages)
        const keywordStats = {};
        const pages = {};

        rows.forEach(r => {
            const imp = r.impressions || 0;
            const clk = r.clicks || 0;
            // No need to sum totals here anymore

            const keyword = r.keys?.[0];
            const page = r.keys?.[1];

            // Aggregating Keywords
            if (keyword) {
                if (!keywordStats[keyword]) keywordStats[keyword] = { imp: 0, clk: 0 };
                keywordStats[keyword].imp += imp;
                keywordStats[keyword].clk += clk;
            }

            // Aggregating Pages
            if (page) {
                if (!pages[page]) pages[page] = { imp: 0, clk: 0 };
                pages[page].imp += imp;
                pages[page].clk += clk;
            }
        });

        // Top 5 Keywords by Clicks (Structured)
        const topKeywordsArr = Object.entries(keywordStats)
            .sort((a, b) => b[1].clk - a[1].clk)
            .slice(0, 5);

        const topKeywordsList = topKeywordsArr.map(entry => entry[0]).join(', '); // Legacy support

        const structuredTopKeywords = topKeywordsArr.map(([keyword, metrics]) => ({
            keyword,
            impressions: metrics.imp,
            clicks: metrics.clk
        }));

        // Top 5 Pages by Impressions
        const topPagesArr = Object.entries(pages).sort((a, b) => b[1].imp - a[1].imp).slice(0, 5);
        const topPagesList = topPagesArr.map(([url, metrics]) => {
            return `${url} (${metrics.imp} imp | ${metrics.clk} clicks)`;
        }).join(' | ');

        // 2. GSC Inspection
        console.log('Fetching & Inspecting Sitemaps...');
        const failedUrls = [];
        let errors = 0;
        const exactErrorsMap = {};
        let inspectedUrls = 0;
        let totalSitemapUrls = 0;

        try {
            const allUrls = await fetchSitemapUrls(siteUrl, { logger: console });
            const uniqueUrls = [...new Set(allUrls)];
            totalSitemapUrls = uniqueUrls.length;

            const urlsToInspect = uniqueUrls.slice(0, Math.min(uniqueUrls.length, project.auditMaxPages || 200));
            inspectedUrls = urlsToInspect.length;
            console.log(`Inspecting ${urlsToInspect.length} URLs...`);

            const batchSize = 5;
            for (let index = 0; index < urlsToInspect.length; index += batchSize) {
                const batch = urlsToInspect.slice(index, index + batchSize);
                const batchIssues = await Promise.all(batch.map(async (url) => {
                    const result = await gsc.inspectUrl(siteUrl, url, { authClient });
                    const idxResult = result?.inspectionResult?.indexStatusResult;
                    const hasIssue = idxResult?.verdict !== 'PASS'
                        || idxResult?.robotsTxtState === 'BLOCKED'
                        || idxResult?.indexingState === 'BLOCKED';

                    if (!hasIssue) {
                        return null;
                    }

                    return {
                        url,
                        reason: idxResult?.coverageState || 'Unknown',
                    };
                }));

                for (const issue of batchIssues.filter(Boolean)) {
                    errors += 1;
                    exactErrorsMap[issue.reason] = (exactErrorsMap[issue.reason] || 0) + 1;
                    failedUrls.push(issue);
                }
            }
        } catch (e) {
            console.error('Sitemap/Inspection error:', e.message);
            // Don't fail the whole request
        }

        const exactErrors = Object.entries(exactErrorsMap).map(([k, v]) => `${k} (${v})`).join(', ');

        // 3. GA4
        console.log('Fetching GA4 Data...');
        let gaResult = { engagementRate: '0', averageSessionDuration: '0' };
        try {
            gaResult = await ga4.getGA4Data(ga4PropertyId, { authClient });
        } catch (e) {
            console.error('GA4 Error:', e.message);
        }

        // Format Session Duration (mm:ss)
        let formattedDuration = '0:00';
        if (gaResult.averageSessionDuration) {
            const totalSeconds = Math.floor(Number(gaResult.averageSessionDuration));
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            formattedDuration = `${minutes}:${seconds.toString().padStart(2, '0')}`;
        }

        const engagementRatePercent = (parseFloat(gaResult.engagementRate || 0) * 100).toFixed(2);

        // 4. PSI
        console.log('Running PageSpeed Insights...');
        const psiResult = await psi.getPSI(siteUrl);

        // Mobile Score
        const psiMobileScore = psiResult.mobile?.lighthouseResult?.categories?.performance?.score * 100 || 0;

        // Desktop Score
        const psiDesktopScore = psiResult.desktop?.lighthouseResult?.categories?.performance?.score * 100 || 0;

        const desktopAudits = psiResult.desktop?.lighthouseResult?.audits || {};
        const LCP_Desktop = desktopAudits['largest-contentful-paint']?.displayValue || 'N/A';
        const CLS_Desktop = desktopAudits['cumulative-layout-shift']?.displayValue || 'N/A';
        const INP_Desktop = desktopAudits['interaction-to-next-paint']?.displayValue || 'N/A';

        const mobileAudits = psiResult.mobile?.lighthouseResult?.audits || {};
        const LCP_Mobile = mobileAudits['largest-contentful-paint']?.displayValue || 'N/A';
        const CLS_Mobile = mobileAudits['cumulative-layout-shift']?.displayValue || 'N/A';
        const INP_Mobile = mobileAudits['interaction-to-next-paint']?.displayValue || 'N/A';

        // Warnings / Notices from PSI
        let psiWarnings = 0;
        let psiNotices = 0;

        Object.values(desktopAudits).forEach(a => {
            if (a.score > 0 && a.score < 1) psiWarnings++;
            else if (a.scoreDisplayMode === 'informative') psiNotices++;
        });

        // 5. Calculate Health Score (sampling-aware)
        let score = 100;

        const coverageFactor = totalSitemapUrls > 0 && inspectedUrls > 0
            ? inspectedUrls / totalSitemapUrls
            : 1;
        const errorRate = inspectedUrls > 0 ? errors / inspectedUrls : 0;
        const estimatedErrors = totalSitemapUrls > 0 ? Math.round(errorRate * totalSitemapUrls) : errors;

        // A. GSC Errors (use estimated total when sampling)
        score -= Math.min(estimatedErrors * 1.2, 40);
        // B. Warnings (PSI)
        score -= Math.min(psiWarnings * 0.7, 20);
        // C. Notices (PSI)
        score -= Math.min(psiNotices * 0.2, 10);

        // D. CWV
        let cwvPenalty = 0;
        if (parseFloat(LCP_Desktop) > 2.5) cwvPenalty += 8;
        if (parseFloat(CLS_Desktop) > 0.1) cwvPenalty += 6;
        score -= Math.min(cwvPenalty, 15);

        // E. Coverage confidence (light penalty when sampled)
        if (coverageFactor < 1) {
            score -= Math.min(10, Math.round((1 - coverageFactor) * 10));
        }

        score = Math.max(5, Math.round(score));

        let status = 'Green';
        // 6. Top Pages (Structured)
        const structuredTopPagesArr = Object.entries(pages)
            .sort((a, b) => b[1].imp - a[1].imp)
            .slice(0, 5);

        const structuredTopPages = structuredTopPagesArr.map(([url, metrics]) => ({
            url,
            impressions: metrics.imp,
            clicks: metrics.clk
        }));

        if (score < 45) status = 'Red';
        else if (score < 75) status = 'Orange';

        // 6. Alerts Logic (n8n)
        let alerts = [];
        if (clicks < 20) alerts.push('Low clicks');
        if (parseFloat(ctr) < 2) alerts.push('Low CTR');
        const projectName = project.name;
        const domain = project.domain; // or derive from siteUrl

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
                lcpDesktop: LCP_Desktop,
                clsDesktop: CLS_Desktop,
                inpDesktop: INP_Desktop,
                lcpMobile: LCP_Mobile,
                clsMobile: CLS_Mobile,
                inpMobile: INP_Mobile
            },
            issues: {
                errors,
                // Separate Indexing vs PSI
                indexingWarnings: 0,
                psiWarnings,
                psiNotices,
                exactErrors,
                failedUrls, // Detailed list
                inspectedUrls,
                totalSitemapUrls,
                isSampled: totalSitemapUrls > inspectedUrls,
            },
            keywords: {
                count: Object.keys(keywordStats).length,
                top: structuredTopKeywords // Now structured array
            },
            pages: {
                top: structuredTopPages // Now structured array
            },
            health: {
                score,
                status,
                alerts
            },
            // Flat Report Format (Matching User Request)
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
                LCP_Desktop: LCP_Desktop,
                CLS_Desktop: CLS_Desktop,
                INP_Desktop: INP_Desktop,
                LCP_Mobile: LCP_Mobile,
                CLS_Mobile: CLS_Mobile,
                INP_Mobile: INP_Mobile,
                Errors: errors,
                Exact_Errors: exactErrors,
                Inspected_Sitemap_URLs: inspectedUrls,
                Total_Sitemap_URLs: totalSitemapUrls,
                PSI_Warnings: psiWarnings,
                PSI_Notices: psiNotices,
                KeywordCount: Object.keys(keywordStats).length,
                TopKeywords: topKeywordsList,
                Top_Page: topPagesList, // Note: user asked for "Top_Page" but n8n code usually has list or string.
                Site_Health_Score: score,
                SEO_Status: status
            }
        };

        // Save to History
        const historyRecord = await history.addToHistory(finalResponse, project.id);

        // Export to Sheets
        let sheetStatus = false;
        let spreadsheetUrl = null;
        if (project.spreadsheetId) {
            console.log('Exporting to Google Sheets...');
            sheetStatus = await sheets.appendRow(project.spreadsheetId, project.sheetGid, finalResponse.report, { authClient });
            spreadsheetUrl = `https://docs.google.com/spreadsheets/d/${project.spreadsheetId}/edit#gid=${project.sheetGid}`;
        }

        res.json({
            ...finalResponse,
            analysisHistoryId: historyRecord?.id || null,
            sheetStatus,
            spreadsheetUrl,
        });

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
                    error: 'Google account is authenticated but lacks required Search Console/GA4 permissions. Reconnect the correct Google account from the project setup page and ensure it has access to the selected properties.'
                });
                return;
            }
            res.status(403).json({
                error: 'Google API access denied. Ensure APIs are enabled and the authenticated account has permission to this property.'
            });
            return;
        }
        res.status(500).json({ error: e.message });
    }
};
module.exports = { analyzeSite };

