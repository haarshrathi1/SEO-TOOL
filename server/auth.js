require('dotenv').config();
const { google } = require('googleapis');
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const redirectUri = process.env.REDIRECT_URI;

if (!clientId || !clientSecret || !redirectUri) {
  console.error('CRITICAL ERROR: Missing Google OAuth Environment Variables.');
  console.error('Please verify .env has CLIENT_ID, CLIENT_SECRET, and REDIRECT_URI');
}

console.log('Initializing OAuth Client with ID:', clientId ? 'Set' : 'Missing');

const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');

const oauth2Client = new google.auth.OAuth2(
  clientId,
  clientSecret,
  redirectUri
);

// Scopes for GSC, GA4, and PSI
const SCOPES = [
  'https://www.googleapis.com/auth/webmasters.readonly', // GSC
  'https://www.googleapis.com/auth/analytics.readonly',  // GA4
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/spreadsheets',      // Google Sheets
  'https://www.googleapis.com/auth/indexing'           // Indexing API
];

// Token persistence
const DATA_DIR = path.join(__dirname, 'data');
const TOKEN_FILE = path.join(DATA_DIR, 'tokens.json');

// Ensure data dir exists
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// Load tokens on startup
if (fs.existsSync(TOKEN_FILE)) {
  try {
    const savedTokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    oauth2Client.setCredentials(savedTokens);
    global.oauthTokens = savedTokens;
    console.log('Loaded saved tokens from disk for Persistent Auth.');
  } catch (e) {
    console.error('Failed to load tokens:', e.message);
  }
}

router.get('/login', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline', // crucial for refresh token
    scope: SCOPES,
    prompt: 'consent' // force consent
  });
  res.redirect(url);
});

router.get('/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Save to disk for persistence
    fs.writeFileSync(TOKEN_FILE, JSON.stringify(tokens, null, 2));
    global.oauthTokens = tokens;

    console.log('Authentication successful & saved');
    res.redirect(`${frontendUrl}?auth=success`);
  } catch (error) {
    console.error('Error authenticating', error);
    res.status(500).send('Authentication failed');
  }
});

// Helper to get authenticated client
const getAuthClient = () => {
  // 1. Try OAuth2 (User)
  if (oauth2Client.credentials && oauth2Client.credentials.access_token) {
    return oauth2Client;
  }

  // 2. Fallback to Service Account
  const serviceAccount = getServiceAccountAuth();
  if (serviceAccount) {
    console.log('Using Service Account for Authentication');
    return serviceAccount;
  }

  return null;
};

const getServiceAccountAuth = () => {
  const keyPath = path.join(DATA_DIR, 'service_account.json');
  if (fs.existsSync(keyPath)) {
    console.log('Found Service Account key at:', keyPath);
    return new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ['https://www.googleapis.com/auth/indexing'],
    });
  } else {
    console.log('Service Account key NOT found at:', keyPath);
  }
  return null;
};

module.exports = { router, getAuthClient, oauth2Client, getServiceAccountAuth };



