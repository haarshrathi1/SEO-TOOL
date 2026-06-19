const { google } = require('googleapis');
const { getAuthClient, getServiceAccountAuth, getProjectAuthClient } = require('./auth');

async function getIndexingClient(project) {
    // Priority 1: Project-specific Google connection
    if (project) {
        const projectAuth = await getProjectAuthClient(project);
        if (projectAuth) {
            return google.indexing({ version: 'v3', auth: projectAuth });
        }
    }

    // Priority 2: Service Account
    const saAuth = getServiceAccountAuth();
    if (saAuth) {
        try {
            const client = await saAuth.getClient();
            return google.indexing({ version: 'v3', auth: client });
        } catch (e) {
            console.error('Service Account Load Error:', e.message);
        }
    }

    // Priority 3: Shared admin OAuth
    const auth = getAuthClient();
    if (!auth) throw new Error('Not authenticated. Connect a Google account or sign in as admin.');
    return google.indexing({ version: 'v3', auth });
}

const publish = async (url, project) => {
    try {
        const service = await getIndexingClient(project);
        console.log(`Requesting indexing for: ${url}`);
        const res = await service.urlNotifications.publish({
            requestBody: { url, type: 'URL_UPDATED' },
        });
        return res.data;
    } catch (e) {
        console.error('Indexing API Error:', e.message);
        return { error: e.message };
    }
};

const remove = async (url, project) => {
    try {
        const service = await getIndexingClient(project);
        console.log(`Requesting removal for: ${url}`);
        const res = await service.urlNotifications.publish({
            requestBody: { url, type: 'URL_DELETED' },
        });
        return res.data;
    } catch (e) {
        console.error('Indexing API Error (Delete):', e.message);
        return { error: e.message };
    }
};

const getMetadata = async (url, project) => {
    try {
        const service = await getIndexingClient(project);
        const res = await service.urlNotifications.getMetadata({ url });
        return res.data;
    } catch (e) {
        console.error('Indexing Metadata Error:', e.message);
        return { error: e.message };
    }
};

module.exports = { publish, remove, getMetadata };
