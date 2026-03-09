const axios = require('axios');

// Using direct HTTP call as it's simpler for PSI than setting up the full GoogleAuth client for a public API
// (unless using private API key, which we get from Auth client if needed? 
// actually n8n used an API Key "AIza...").
// We should probably rely on the User's OAuth token OR just calling it without auth (lower limit) 
// OR user needs to provide API Key in .env. 
// For now, we will try without key (lower quota) or use the Access Token if possible.
// Actually, PSI API key is public usually. 
// We will use the Google Auth Access Token which works for Quota.
const { getAuthClient } = require('./auth');

const getPSI = async (url) => {
    const auth = getAuthClient();
    // we can get the token and pass it as key or bearer
    // but PSI v5 supports access_token query param.

    let token = '';
    if (auth) {
        const credentials = await auth.getAccessToken(); // refresh if needed
        token = credentials.token;
    }

    const strategies = ['desktop', 'mobile'];
    const results = {};

    for (const strategy of strategies) {
        try {
            const endpoint = `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=${strategy}&category=PERFORMANCE&category=SEO`;

            // Add token if available
            const headers = token ? { Authorization: `Bearer ${token}` } : {};

            const response = await axios.get(endpoint, { headers, timeout: 60000 });
            results[strategy] = response.data;
        } catch (e) {
            console.error(`PSI Error for ${strategy}`, e.message);
            results[strategy] = { error: e.message };
        }
    }

    return results;
};

module.exports = { getPSI };
