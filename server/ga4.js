const { google } = require('googleapis');
const { getAuthClient } = require('./auth');
const { getWeeklyDateRange } = require('./utils');

function resolveAuthClient(authClient) {
    const resolved = authClient || getAuthClient();
    if (!resolved) throw new Error('Not authenticated');
    return resolved;
}

function normalizePagePathKey(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return '';
    }

    const raw = value.trim();
    try {
        const parsed = new URL(raw, 'https://placeholder.local');
        const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${pathname}${parsed.search}`;
    } catch {
        return raw.replace(/\/+$/, '') || raw;
    }
}

const getGA4Data = async (propertyId, options = {}) => {
    const auth = resolveAuthClient(options.authClient);

    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
    const { startDate, endDate } = getWeeklyDateRange();

    try {
        const response = await analyticsData.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
                dateRanges: [{ startDate, endDate }],
                metrics: [
                    { name: 'engagementRate' },
                    { name: 'averageSessionDuration' }
                ]
            }
        });

        const row = response.data.rows?.[0];
        return {
            engagementRate: row?.metricValues?.[0]?.value || '0',
            averageSessionDuration: row?.metricValues?.[1]?.value || '0',
            dateRange: { startDate, endDate }
        };
    } catch (e) {
        console.error('Error fetching GA4 data', e.message);
        return { error: e.message };
    }
};

const getPageViewMap = async (propertyId, options = {}) => {
    if (!propertyId) {
        return {};
    }

    const auth = resolveAuthClient(options.authClient);

    const analyticsData = google.analyticsdata({ version: 'v1beta', auth });
    const { startDate, endDate } = options.startDate && options.endDate
        ? { startDate: options.startDate, endDate: options.endDate }
        : getWeeklyDateRange();

    const metricCandidates = ['screenPageViews', 'views'];
    for (const metricName of metricCandidates) {
        try {
            const response = await analyticsData.properties.runReport({
                property: `properties/${propertyId}`,
                requestBody: {
                    dateRanges: [{ startDate, endDate }],
                    dimensions: [{ name: 'pagePathPlusQueryString' }],
                    metrics: [{ name: metricName }],
                    limit: 100000,
                },
            });

            const pageViewMap = {};
            (response.data.rows || []).forEach((row) => {
                const pagePath = normalizePagePathKey(row.dimensionValues?.[0]?.value || '');
                const views = Number(row.metricValues?.[0]?.value || 0);
                if (pagePath) {
                    pageViewMap[pagePath] = (pageViewMap[pagePath] || 0) + views;
                }
            });

            return pageViewMap;
        } catch (e) {
            if (metricName === metricCandidates[metricCandidates.length - 1]) {
                console.error('Error fetching page-level GA4 data', e.message);
            }
        }
    }

    return {};
};

module.exports = {
    getGA4Data,
    getPageViewMap,
    __internal: {
        normalizePagePathKey,
    },
};
