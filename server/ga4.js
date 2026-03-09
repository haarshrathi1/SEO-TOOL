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
                ],
                dimensions: [
                    { name: 'yearWeek' } // Breakdown by week if needed, or just aggregate
                ]
            }
        });

        // Extract the first row (aggregate for the week usually, or we can remove dimension for total)
        // If we use 'yearWeek', we might get multiple rows if the range spans weeks?
        // Let's remove dimension for simple aggregation of the range.

        // RE-RUN without dimension for total
        const totalResponse = await analyticsData.properties.runReport({
            property: `properties/${propertyId}`,
            requestBody: {
                dateRanges: [{ startDate, endDate }],
                metrics: [
                    { name: 'engagementRate' },
                    { name: 'averageSessionDuration' }
                ]
            }
        });
        const row = totalResponse.data.rows?.[0];
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
