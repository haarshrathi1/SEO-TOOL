const { google } = require('googleapis');
const { getAuthClient } = require('./auth');
const axios = require('axios'); // For fetching sitemap XML
const { getWeeklyDateRange } = require('./utils');

const parseSitemap = async (url) => {
    try {
        const response = await axios.get(url);
        const xml = response.data;
        if (!xml) return [];
        const matches = [...xml.matchAll(/<loc>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/loc>/g)];
        return matches.map(m => m[1].trim());
    } catch (e) {
        console.error(`Failed to fetch sitemap ${url}`, e.message);
        return [];
    }
};

function computeSiteTotals(rows = []) {
    let clicks = 0;
    let impressions = 0;
    let weightedPositionSum = 0;

    rows.forEach((row) => {
        const rowClicks = Number(row?.clicks || 0);
        const rowImpressions = Number(row?.impressions || 0);
        const rowPosition = Number(row?.position || 0);

        clicks += rowClicks;
        impressions += rowImpressions;

        if (rowImpressions > 0 && Number.isFinite(rowPosition)) {
            weightedPositionSum += rowPosition * rowImpressions;
        }
    });

    return {
        clicks,
        impressions,
        ctr: impressions ? ((clicks / impressions) * 100).toFixed(2) : '0.00',
        avgPosition: impressions ? (weightedPositionSum / impressions).toFixed(2) : '0.00',
    };
}

const getPerformance = async (siteUrl, options = {}) => {
    const auth = getAuthClient();
    if (!auth) throw new Error('Not authenticated');
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    // Use provided range or fallback to weekly default
    let startDate, endDate, weekLabel;

    if (options.startDate && options.endDate) {
        startDate = options.startDate;
        endDate = options.endDate;
    } else {
        const dateRange = getWeeklyDateRange();
        startDate = dateRange.startDate;
        endDate = dateRange.endDate;
        weekLabel = dateRange.weekLabel;
    }

    // Fetch query/page breakdown with pagination (Search Console caps each page)
    const dimensions = options.dimensions || ['query', 'page'];
    const rows = [];
    const pageSize = 25000;
    let startRow = 0;

    while (true) {
        const res = await searchconsole.searchanalytics.query({
            siteUrl,
            requestBody: {
                startDate,
                endDate,
                dimensions,
                rowLimit: pageSize,
                startRow,
            },
        });

        const pageRows = res.data.rows || [];
        rows.push(...pageRows);

        if (pageRows.length < pageSize) {
            break;
        }

        startRow += pageSize;

        // Safety guard: stop after 200k rows to avoid runaway loops on huge properties
        if (startRow >= 200000) {
            console.warn('GSC pagination stopped after 200k rows to prevent runaway queries.');
            break;
        }
    }

    return {
        rows,
        dateRange: { startDate, endDate, weekLabel },
    };
};

const getSiteTotals = async (siteUrl) => {
    const auth = getAuthClient();
    if (!auth) throw new Error('Not authenticated');
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    const { startDate, endDate } = getWeeklyDateRange();

    // Fetch by 'date' dimension for authoritative totals (excludes privacy filtering effects logic often found in query-level data)
    const res = await searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
            startDate,
            endDate,
            dimensions: ['date'],
            rowLimit: 1000
        }
    });

    return computeSiteTotals(res.data.rows || []);
};

const inspectUrl = async (siteUrl, inspectionUrl) => {
    const auth = getAuthClient();
    if (!auth) throw new Error('Not authenticated');
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    try {
        const res = await searchconsole.urlInspection.index.inspect({
            requestBody: {
                inspectionUrl,
                siteUrl
            }
        });
        return res.data;
    } catch (e) {
        console.error(`Error inspecting ${inspectionUrl}`, e.message);
        return { error: e.message };
    }
};

const getSitemaps = async (siteUrl) => {
    const auth = getAuthClient();
    if (!auth) throw new Error('Not authenticated');
    const searchconsole = google.searchconsole({ version: 'v1', auth });

    const res = await searchconsole.sitemaps.list({ siteUrl });
    return res.data.sitemap || [];
};

module.exports = {
    getPerformance,
    getSiteTotals,
    getSitemaps,
    inspectUrl,
    parseSitemap,
    __internal: {
        computeSiteTotals,
    },
};
