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

    // Fetch query/page breakdown
    const dimensions = options.dimensions || ['query', 'page'];
    const res = await searchconsole.searchanalytics.query({
        siteUrl,
        requestBody: {
            startDate,
            endDate,
            dimensions,
            rowLimit: 25000
        }
    });

    return {
        rows: res.data.rows || [],
        dateRange: { startDate, endDate, weekLabel }
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

    const rows = res.data.rows || [];
    let clicks = 0;
    let impressions = 0;
    let positionSum = 0;
    let positionCount = 0;

    rows.forEach(r => {
        clicks += r.clicks || 0;
        impressions += r.impressions || 0;
        if (r.position) {
            positionSum += r.position;
            positionCount++;
        }
    });

    return {
        clicks,
        impressions,
        ctr: impressions ? ((clicks / impressions) * 100).toFixed(2) : '0.00',
        avgPosition: positionCount ? (positionSum / positionCount).toFixed(2) : '0.00'
    };
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
    parseSitemap
};
