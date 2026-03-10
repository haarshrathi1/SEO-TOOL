const { google } = require('googleapis');
const { getAuthClient } = require('./auth');
const { getWeeklyDateRange } = require('./utils');

const getGA4Data = async (propertyId) => {
    const auth = getAuthClient();
    if (!auth) throw new Error('Not authenticated');

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

module.exports = { getGA4Data };
