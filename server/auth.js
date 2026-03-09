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
const DISABLE_SERVICE_ACCOUNT = /^(1|true|yes|on)$/i.test(process.env.DISABLE_SERVICE_ACCOUNT || '');

const oauth2Client = new google.auth.OAuth2(
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

const SERVICE_ACCOUNT_SCOPES = [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/webmasters',
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/indexing',
];

async function initializeAuth() {
    try {
        const tokenDoc = await OauthToken.findOne({ provider: TOKEN_PROVIDER }).lean();
        if (!tokenDoc?.tokens) return;

        oauth2Client.setCredentials(tokenDoc.tokens);
        global.oauthTokens = tokenDoc.tokens;
        console.log('Loaded saved tokens from MongoDB for persistent auth.');
    } catch (e) {
        console.error('Failed to load tokens from MongoDB:', e.message);
    }
}

router.get('/login', (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
    });
    res.redirect(url);
});

router.get('/callback', async (req, res) => {
    const { code } = req.query;
    try {
        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        await OauthToken.findOneAndUpdate(
            { provider: TOKEN_PROVIDER },
            { provider: TOKEN_PROVIDER, tokens, updatedAt: new Date() },
            { upsert: true, setDefaultsOnInsert: true }
        );

        global.oauthTokens = tokens;

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

module.exports = { router, getAuthClient, oauth2Client, getServiceAccountAuth, initializeAuth };

