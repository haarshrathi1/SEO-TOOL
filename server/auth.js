require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { google } = require('googleapis');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { OauthToken } = require('./models');

const router = express.Router();

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const redirectUri = process.env.REDIRECT_URI;

if (!clientId || !clientSecret || !redirectUri) {
    console.error('CRITICAL ERROR: Missing Google OAuth Environment Variables.');
    console.error('Please verify .env has CLIENT_ID, CLIENT_SECRET, and REDIRECT_URI');
}

console.log('Initializing OAuth Client with ID:', clientId ? 'Set' : 'Missing');

const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
const TOKEN_PROVIDER = 'google-oauth';
const GOOGLE_ADS_TOKEN_PROVIDER = 'google-ads-oauth';
const isProduction = process.env.NODE_ENV === 'production';
const disableServiceAccountRaw = process.env.DISABLE_SERVICE_ACCOUNT ?? (isProduction ? 'true' : 'false');
const DISABLE_SERVICE_ACCOUNT = /^(1|true|yes|on)$/i.test(disableServiceAccountRaw);
const GOOGLE_ADS_OAUTH_SCOPE = 'https://www.googleapis.com/auth/adwords';

const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
);
const googleAdsOauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUri
);

const SCOPES = [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/webmasters',
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/indexing',
];

const GOOGLE_ADS_SCOPES = [
    GOOGLE_ADS_OAUTH_SCOPE,
    'openid',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
];

const SERVICE_ACCOUNT_SCOPES = [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/webmasters',
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/indexing',
];

async function initializeAuth() {
    try {
        const [defaultTokenDoc, googleAdsTokenDoc] = await Promise.all([
            OauthToken.findOne({ provider: TOKEN_PROVIDER }).lean(),
            OauthToken.findOne({ provider: GOOGLE_ADS_TOKEN_PROVIDER }).lean(),
        ]);

        if (defaultTokenDoc?.tokens) {
            oauth2Client.setCredentials(defaultTokenDoc.tokens);
            global.oauthTokens = defaultTokenDoc.tokens;
            console.log('Loaded saved default Google tokens from MongoDB for persistent auth.');
        }

        if (googleAdsTokenDoc?.tokens) {
            googleAdsOauth2Client.setCredentials(googleAdsTokenDoc.tokens);
            global.googleAdsOauthTokens = googleAdsTokenDoc.tokens;
            console.log('Loaded saved Google Ads tokens from MongoDB for persistent auth.');
        }
    } catch (e) {
        console.error('Failed to load tokens from MongoDB:', e.message);
    }
}

router.get('/login', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        state: TOKEN_PROVIDER,
    });
    res.redirect(url);
});

router.get('/login/ads', (req, res) => {
    const url = googleAdsOauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_ADS_SCOPES,
        prompt: 'consent',
        state: GOOGLE_ADS_TOKEN_PROVIDER,
    });
    res.redirect(url);
});

router.get('/callback', async (req, res) => {
    const { code } = req.query;
    const requestedProvider = req.query.state === GOOGLE_ADS_TOKEN_PROVIDER
        ? GOOGLE_ADS_TOKEN_PROVIDER
        : TOKEN_PROVIDER;
    const selectedClient = requestedProvider === GOOGLE_ADS_TOKEN_PROVIDER
        ? googleAdsOauth2Client
        : oauth2Client;

    try {
        const { tokens } = await selectedClient.getToken(code);
        selectedClient.setCredentials(tokens);

        await OauthToken.findOneAndUpdate(
            { provider: requestedProvider },
            { provider: requestedProvider, tokens, updatedAt: new Date() },
            { upsert: true, setDefaultsOnInsert: true }
        );

        if (requestedProvider === GOOGLE_ADS_TOKEN_PROVIDER) {
            global.googleAdsOauthTokens = tokens;
        } else {
            global.oauthTokens = tokens;
        }

        console.log('Authentication successful & saved to MongoDB');
        res.redirect(`${frontendUrl}?auth=success`);
    } catch (error) {
        console.error('Error authenticating', error);
        res.status(500).send('Authentication failed');
    }
});

const getAuthClient = () => {
    const credentials = oauth2Client.credentials || {};
    // Prefer user OAuth if either token exists (refresh token can mint access tokens on demand).
    if (credentials.access_token || credentials.refresh_token) {
        return oauth2Client;
    }
    if (DISABLE_SERVICE_ACCOUNT) {
        return null;
    }
    const serviceAccount = getServiceAccountAuth();
    if (serviceAccount) {
        console.log('Using Service Account for Authentication');
        return serviceAccount;
    }
    return null;
};

function getStoredOauthTokens() {
    return oauth2Client.credentials || global.oauthTokens || null;
}

function getStoredGoogleAdsOauthTokens() {
    return googleAdsOauth2Client.credentials || global.googleAdsOauthTokens || null;
}

function hasOauthScope(scope, tokens = getStoredOauthTokens()) {
    if (!scope || !tokens?.scope) {
        return false;
    }

    const scopes = Array.isArray(tokens.scope)
        ? tokens.scope
        : String(tokens.scope).split(/\s+/).filter(Boolean);

    return scopes.includes(scope);
}

const getServiceAccountAuth = () => {
    const keyPath = path.join(__dirname, 'data', 'service_account.json');
    if (fs.existsSync(keyPath)) {
        console.log('Found Service Account key at:', keyPath);
        return new google.auth.GoogleAuth({
            keyFile: keyPath,
            scopes: SERVICE_ACCOUNT_SCOPES,
        });
    }

    console.log('Service Account key NOT found at:', keyPath);
    return null;
};

module.exports = {
    GOOGLE_ADS_OAUTH_SCOPE,
    GOOGLE_ADS_TOKEN_PROVIDER,
    router,
    getAuthClient,
    getStoredOauthTokens,
    getStoredGoogleAdsOauthTokens,
    hasOauthScope,
    googleAdsOauth2Client,
    oauth2Client,
    getServiceAccountAuth,
    initializeAuth,
};

