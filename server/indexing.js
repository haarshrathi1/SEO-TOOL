const { google } = require('googleapis');
const { getAuthClient, getServiceAccountAuth } = require('./auth');

const getBoxingClient = async () => {
    // Priority 1: Service Account (Required for Indexing API usually)
    const saAuth = getServiceAccountAuth();
    if (saAuth) {
        try {
            const client = await saAuth.getClient();
            return google.indexing({ version: 'v3', auth: client });
        } catch (e) {
            console.error('Service Account Load Error:', e.message);
        }
    }

    // Priority 2: User OAuth (Fallback)
    const auth = getAuthClient();
    if (!auth) throw new Error('Not authenticated. Please add service_account.json to server/data/ or sign in.');
    return google.indexing({ version: 'v3', auth });
};

/**
 * Request indexing (URL_UPDATED).
 * Use this when a page is added or updated.
 * @param {string} url 
 */
const publish = async (url) => {
    try {
        const service = await getBoxingClient();
        console.log(`Requesting indexing for: ${url}`);
        const res = await service.urlNotifications.publish({
            requestBody: {
                url: url,
                type: 'URL_UPDATED'
            }
        });
        return res.data;
    } catch (e) {
        console.error('Indexing API Error:', e.message);
        return { error: e.message };
    }
};

/**
 * Request removal (URL_DELETED).
 * Use this when a page is deleted/404.
 * @param {string} url 
 */
const remove = async (url) => {
    try {
        const service = await getBoxingClient();
        console.log(`Requesting removal for: ${url}`);
        const res = await service.urlNotifications.publish({
            requestBody: {
                url: url,
                type: 'URL_DELETED'
            }
        });
        return res.data;
    } catch (e) {
        console.error('Indexing API Error (Delete):', e.message);
        return { error: e.message };
    }
};

module.exports = { publish, remove };
