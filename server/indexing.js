const { google } = require('googleapis');
const { getAuthClient, getServiceAccountAuth } = require('./auth');

const GENERIC_INDEXING_REQUESTS_ENABLED = /^(1|true|yes|on)$/i.test(process.env.ENABLE_GENERIC_INDEXING_REQUESTS || '');
const INDEXING_DISABLED_MESSAGE = 'Indexing API requests are disabled by default. Enable ENABLE_GENERIC_INDEXING_REQUESTS only for supported page types and verified workflows.';

const getBoxingClient = async () => {
    const saAuth = getServiceAccountAuth();
    if (saAuth) {
        try {
            const client = await saAuth.getClient();
            return google.indexing({ version: 'v3', auth: client });
        } catch (e) {
            console.error('Service Account Load Error:', e.message);
        }
    }

    const auth = getAuthClient();
    if (!auth) throw new Error('Not authenticated. Please add service_account.json to server/data/ or sign in.');
    return google.indexing({ version: 'v3', auth });
};

const publish = async (url) => {
    if (!GENERIC_INDEXING_REQUESTS_ENABLED) {
        return { error: INDEXING_DISABLED_MESSAGE };
    }

    try {
        const service = await getBoxingClient();
        console.log(`Requesting indexing for: ${url}`);
        const res = await service.urlNotifications.publish({
            requestBody: {
                url,
                type: 'URL_UPDATED',
            },
        });
        return res.data;
    } catch (e) {
        console.error('Indexing API Error:', e.message);
        return { error: e.message };
    }
};

const remove = async (url) => {
    if (!GENERIC_INDEXING_REQUESTS_ENABLED) {
        return { error: INDEXING_DISABLED_MESSAGE };
    }

    try {
        const service = await getBoxingClient();
        console.log(`Requesting removal for: ${url}`);
        const res = await service.urlNotifications.publish({
            requestBody: {
                url,
                type: 'URL_DELETED',
            },
        });
        return res.data;
    } catch (e) {
        console.error('Indexing API Error (Delete):', e.message);
        return { error: e.message };
    }
};

module.exports = { publish, remove };
