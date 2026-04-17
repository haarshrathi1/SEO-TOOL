require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { google } = require('googleapis');
const express = require('express');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const { OauthToken, Project, UserGoogleConnection } = require('./models');
const { getProject } = require('./projects');

const router = express.Router();
const userRouter = express.Router();

const clientId = process.env.CLIENT_ID;
const clientSecret = process.env.CLIENT_SECRET;
const redirectUri = process.env.REDIRECT_URI;
const stateSecret = process.env.JWT_SECRET || process.env.CLIENT_SECRET || 'development-google-state-secret';

if (!clientId || !clientSecret || !redirectUri) {
    console.error('CRITICAL ERROR: Missing Google OAuth Environment Variables.');
    console.error('Please verify .env has CLIENT_ID, CLIENT_SECRET, and REDIRECT_URI');
}

console.log('Initializing OAuth Client with ID:', clientId ? 'Set' : 'Missing');

const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
const TOKEN_PROVIDER = 'google-oauth';
const GOOGLE_ADS_TOKEN_PROVIDER = 'google-ads-oauth';
const USER_GOOGLE_PROVIDER = 'google-user-oauth';
const USER_GOOGLE_STATE_KIND = 'user_google_connection';
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

const USER_SCOPES = [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/webmasters',
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
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

function createOauthClient() {
    return new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri
    );
}

function normalizeEmail(value) {
    return typeof value === 'string' ? value.toLowerCase().trim() : '';
}

function normalizePath(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw || !raw.startsWith('/')) {
        return '/projects';
    }
    return raw;
}

function normalizeComparableSiteUrl(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) return '';

    if (/^sc-domain:/i.test(raw)) {
        return `sc-domain:${raw.replace(/^sc-domain:/i, '').trim().toLowerCase()}`;
    }

    try {
        const parsed = new URL(raw);
        const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
        return `${parsed.origin.toLowerCase()}${pathname}`;
    } catch {
        return raw.toLowerCase();
    }
}

function buildUserOauthState(payload) {
    return jwt.sign({
        kind: USER_GOOGLE_STATE_KIND,
        email: normalizeEmail(payload.email),
        projectId: typeof payload.projectId === 'string' ? payload.projectId.trim() : '',
        redirectPath: normalizePath(payload.redirectPath),
    }, stateSecret, { expiresIn: '15m' });
}

function parseUserOauthState(state) {
    if (!state || typeof state !== 'string' || state === TOKEN_PROVIDER || state === GOOGLE_ADS_TOKEN_PROVIDER) {
        return null;
    }

    try {
        const payload = jwt.verify(state, stateSecret);
        if (payload?.kind !== USER_GOOGLE_STATE_KIND || !payload?.email) {
            return null;
        }

        return {
            email: normalizeEmail(payload.email),
            projectId: typeof payload.projectId === 'string' ? payload.projectId.trim() : '',
            redirectPath: normalizePath(payload.redirectPath),
        };
    } catch {
        return null;
    }
}

function buildFrontendRedirect(pathname, params = {}) {
    const base = `${frontendUrl}${normalizePath(pathname)}`;
    const search = new URLSearchParams();

    Object.entries(params).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }
        search.set(key, String(value));
    });

    const query = search.toString();
    return query ? `${base}?${query}` : base;
}

function sortByDisplayName(items, key = 'label') {
    return [...items].sort((left, right) => String(left[key] || '').localeCompare(String(right[key] || '')));
}

function normalizeComparisonText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

function collapseComparisonText(value) {
    return normalizeComparisonText(value).replace(/\s+/g, '');
}

function extractHostname(value) {
    const raw = typeof value === 'string' ? value.trim() : '';
    if (!raw) {
        return '';
    }

    if (/^sc-domain:/i.test(raw)) {
        return raw.replace(/^sc-domain:/i, '').trim().toLowerCase();
    }

    const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    try {
        return new URL(withProtocol).hostname.toLowerCase();
    } catch {
        return '';
    }
}

function buildProjectRecommendationContext(input = {}, project = null) {
    const name = typeof input.name === 'string' && input.name.trim()
        ? input.name.trim()
        : (project?.name || '');
    const url = typeof input.url === 'string' && input.url.trim()
        ? input.url.trim()
        : (project?.url || '');
    const gscSiteUrl = typeof input.gscSiteUrl === 'string' && input.gscSiteUrl.trim()
        ? input.gscSiteUrl.trim()
        : (project?.gscSiteUrl || '');
    const ga4PropertyId = typeof input.ga4PropertyId === 'string' && input.ga4PropertyId.trim()
        ? input.ga4PropertyId.trim()
        : (project?.ga4PropertyId || '');
    const explicitDomain = typeof input.domain === 'string' && input.domain.trim()
        ? input.domain.trim().toLowerCase()
        : '';
    const urlHostname = extractHostname(url);
    const gscHostname = extractHostname(gscSiteUrl);
    const domain = explicitDomain || project?.domain || urlHostname || gscHostname || '';
    const primaryHostname = urlHostname || gscHostname || domain;
    const hostnameSegments = primaryHostname
        .split('.')
        .map((segment) => segment.trim().toLowerCase())
        .filter(Boolean);
    const primaryHostLabel = hostnameSegments[0] || '';
    const rootDomainLabel = hostnameSegments.length >= 2 ? hostnameSegments[hostnameSegments.length - 2] : (hostnameSegments[0] || '');

    return {
        ...(project || {}),
        name,
        url,
        domain,
        gscSiteUrl,
        ga4PropertyId,
        primaryHostLabel,
        rootDomainLabel,
        nameKey: collapseComparisonText(name),
        domainKey: collapseComparisonText(domain),
        urlHostKey: collapseComparisonText(urlHostname),
        gscHostKey: collapseComparisonText(gscHostname),
    };
}

function suggestSearchConsoleSite(sites = [], project = null) {
    if (!project) {
        return '';
    }

    const normalizedTargets = [
        project.gscSiteUrl,
        project.url,
        project.url?.replace(/\/+$/, ''),
        project.url?.endsWith('/') ? project.url.slice(0, -1) : `${project.url || ''}/`,
        project.domain ? `sc-domain:${project.domain}` : '',
    ].map(normalizeComparableSiteUrl).filter(Boolean);

    return sites.find((site) => normalizedTargets.includes(normalizeComparableSiteUrl(site.siteUrl)))?.siteUrl || '';
}

function suggestGa4Property(properties = [], project = null) {
    if (!project) {
        return '';
    }

    const target = String(project.ga4PropertyId || '').trim();
    if (target) {
        return properties.find((property) => property.propertyId === target)?.propertyId || '';
    }

    const scored = properties
        .map((property) => {
            const propertyKey = collapseComparisonText([
                property.displayName,
                property.account,
                property.label,
            ].filter(Boolean).join(' '));

            let score = 0;
            if (project.nameKey && propertyKey.includes(project.nameKey)) score += 60;
            if (project.domainKey && propertyKey.includes(project.domainKey)) score += 55;
            if (project.urlHostKey && propertyKey.includes(project.urlHostKey)) score += 45;
            if (project.gscHostKey && propertyKey.includes(project.gscHostKey)) score += 45;
            if (project.primaryHostLabel && propertyKey.includes(project.primaryHostLabel)) score += 35;
            if (project.rootDomainLabel && propertyKey.includes(project.rootDomainLabel)) score += 8;

            return { propertyId: property.propertyId, score };
        })
        .filter((entry) => entry.score >= 25)
        .sort((left, right) => right.score - left.score || left.propertyId.localeCompare(right.propertyId));

    return scored[0]?.propertyId || '';
}

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

async function fetchGoogleProfile(authClient) {
    const oauth2 = google.oauth2({ version: 'v2', auth: authClient });
    const response = await oauth2.userinfo.get();
    return {
        email: normalizeEmail(response.data?.email),
        name: response.data?.name || '',
        picture: response.data?.picture || '',
    };
}

async function persistUserGoogleConnection(ownerEmail, tokens) {
    const authClient = createOauthClient();
    authClient.setCredentials(tokens);
    const profile = await fetchGoogleProfile(authClient);

    const connection = await UserGoogleConnection.findOneAndUpdate(
        { ownerEmail: normalizeEmail(ownerEmail) },
        {
            ownerEmail: normalizeEmail(ownerEmail),
            provider: USER_GOOGLE_PROVIDER,
            googleEmail: profile.email || normalizeEmail(ownerEmail),
            displayName: profile.name || '',
            picture: profile.picture || '',
            scope: typeof tokens?.scope === 'string' ? tokens.scope : '',
            tokens,
            connectedAt: new Date(),
            updatedAt: new Date(),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();

    return {
        connection,
        profile,
    };
}

router.get('/callback', async (req, res) => {
    const { code } = req.query;
    const userOauthState = parseUserOauthState(req.query.state);

    if (userOauthState) {
        const userClient = createOauthClient();

        try {
            const { tokens } = await userClient.getToken(code);
            userClient.setCredentials(tokens);

            const { profile } = await persistUserGoogleConnection(userOauthState.email, tokens);

            if (userOauthState.projectId) {
                await Project.findOneAndUpdate(
                    {
                        id: userOauthState.projectId,
                        ownerEmail: userOauthState.email,
                    },
                    {
                        googleConnectionEmail: userOauthState.email,
                        updatedAt: new Date(),
                    }
                );
            }

            res.redirect(buildFrontendRedirect(userOauthState.redirectPath || '/projects', {
                google: 'connected',
                projectId: userOauthState.projectId || '',
                googleEmail: profile.email || userOauthState.email,
            }));
            return;
        } catch (error) {
            console.error('Error authenticating user Google connection', error);
            res.redirect(buildFrontendRedirect(userOauthState.redirectPath || '/projects', {
                google: 'error',
                message: 'Failed to connect Google account',
            }));
            return;
        }
    }

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

async function getUserAuthClient(ownerEmail) {
    const normalizedOwnerEmail = normalizeEmail(ownerEmail);
    if (!normalizedOwnerEmail) {
        return null;
    }

    const connection = await UserGoogleConnection.findOne({ ownerEmail: normalizedOwnerEmail }).lean();
    if (!connection?.tokens) {
        return null;
    }

    const authClient = createOauthClient();
    authClient.setCredentials(connection.tokens);
    return authClient;
}

function resolveProjectAuthSource(project) {
    const explicitConnectionEmail = normalizeEmail(project?.googleConnectionEmail || '');
    if (explicitConnectionEmail) {
        return {
            connectionEmail: explicitConnectionEmail,
            allowSharedFallback: false,
        };
    }

    const ownerEmail = normalizeEmail(project?.ownerEmail || '');
    if (ownerEmail) {
        return {
            connectionEmail: ownerEmail,
            allowSharedFallback: true,
        };
    }

    return {
        connectionEmail: '',
        allowSharedFallback: true,
    };
}

async function getProjectAuthClient(project) {
    const { connectionEmail, allowSharedFallback } = resolveProjectAuthSource(project);
    if (connectionEmail) {
        const userClient = await getUserAuthClient(connectionEmail);
        if (userClient) {
            return userClient;
        }

        if (!allowSharedFallback) {
            return null;
        }
    }

    return getAuthClient();
}

async function hasProjectAuth(project) {
    return Boolean(await getProjectAuthClient(project));
}

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

async function listSearchConsoleSites(authClient) {
    const searchconsole = google.searchconsole({ version: 'v1', auth: authClient });
    const response = await searchconsole.sites.list({});
    return sortByDisplayName((response.data.siteEntry || []).map((site) => ({
        siteUrl: site.siteUrl,
        permissionLevel: site.permissionLevel || '',
        label: site.siteUrl,
        type: /^sc-domain:/i.test(site.siteUrl || '') ? 'domain' : 'url-prefix',
    })));
}

async function listGa4Properties(authClient) {
    const analyticsAdmin = google.analyticsadmin({ version: 'v1beta', auth: authClient });
    const properties = [];
    let pageToken;

    do {
        const response = await analyticsAdmin.accountSummaries.list({
            pageSize: 200,
            pageToken,
        });

        (response.data.accountSummaries || []).forEach((summary) => {
            const accountName = summary.displayName || summary.name || 'Account';
            (summary.propertySummaries || []).forEach((property) => {
                const propertyName = property.property || '';
                const propertyId = propertyName.split('/').pop() || '';
                properties.push({
                    propertyId,
                    propertyName,
                    displayName: property.displayName || propertyId,
                    account: accountName,
                    propertyType: property.propertyType || '',
                    parent: property.parent || '',
                    label: `${property.displayName || propertyId} (${propertyId})`,
                });
            });
        });

        pageToken = response.data.nextPageToken || '';
    } while (pageToken);

    return sortByDisplayName(properties);
}

function serializeConnectionStatus(connection) {
    if (!connection) {
        return {
            connected: false,
            ownerEmail: '',
            googleEmail: '',
            displayName: '',
            picture: '',
            scope: '',
            connectedAt: null,
            updatedAt: null,
        };
    }

    return {
        connected: true,
        ownerEmail: connection.ownerEmail,
        googleEmail: connection.googleEmail || '',
        displayName: connection.displayName || '',
        picture: connection.picture || '',
        scope: connection.scope || '',
        connectedAt: connection.connectedAt || null,
        updatedAt: connection.updatedAt || null,
    };
}

async function getConnectionStatus(ownerEmail) {
    const connection = await UserGoogleConnection.findOne({ ownerEmail: normalizeEmail(ownerEmail) }).lean();
    return serializeConnectionStatus(connection);
}

userRouter.get('/connection', async (req, res) => {
    try {
        const status = await getConnectionStatus(req.user.email);
        res.json(status);
    } catch (error) {
        console.error('Failed to load Google connection status', error);
        res.status(500).json({ error: 'Failed to load Google connection status' });
    }
});

userRouter.get('/connect', async (req, res) => {
    const redirectPath = normalizePath(req.query.redirectPath || '/projects');
    const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
    const url = createOauthClient().generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        include_granted_scopes: true,
        login_hint: req.user.email,
        scope: USER_SCOPES,
        state: buildUserOauthState({
            email: req.user.email,
            projectId,
            redirectPath,
        }),
    });

    res.redirect(url);
});

userRouter.get('/resources', async (req, res) => {
    try {
        const authClient = await getUserAuthClient(req.user.email);
        if (!authClient) {
            return res.status(404).json({ error: 'Google account not connected' });
        }

        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
        const project = projectId ? await getProject(projectId, req.user) : null;
        if (projectId && !project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const recommendationProject = buildProjectRecommendationContext({
            name: req.query.name,
            domain: req.query.domain,
            url: req.query.url,
            gscSiteUrl: req.query.gscSiteUrl,
            ga4PropertyId: req.query.ga4PropertyId,
        }, project);

        const [sites, properties, connectionStatus] = await Promise.all([
            listSearchConsoleSites(authClient),
            listGa4Properties(authClient),
            getConnectionStatus(req.user.email),
        ]);

        return res.json({
            connection: connectionStatus,
            sites,
            properties,
            recommendations: {
                gscSiteUrl: suggestSearchConsoleSite(sites, recommendationProject),
                ga4PropertyId: suggestGa4Property(properties, recommendationProject),
            },
        });
    } catch (error) {
        console.error('Failed to load Google resources', error);
        return res.status(500).json({ error: 'Failed to load Google resources' });
    }
});

module.exports = {
    GOOGLE_ADS_OAUTH_SCOPE,
    GOOGLE_ADS_TOKEN_PROVIDER,
    USER_GOOGLE_PROVIDER,
    router,
    userRouter,
    getAuthClient,
    getUserAuthClient,
    getProjectAuthClient,
    hasProjectAuth,
    getConnectionStatus,
    getStoredOauthTokens,
    getStoredGoogleAdsOauthTokens,
    hasOauthScope,
    googleAdsOauth2Client,
    oauth2Client,
    getServiceAccountAuth,
    initializeAuth,
    __internal: {
        normalizeEmail,
        normalizePath,
        normalizeComparableSiteUrl,
        normalizeComparisonText,
        collapseComparisonText,
        extractHostname,
        buildProjectRecommendationContext,
        resolveProjectAuthSource,
        suggestSearchConsoleSite,
        suggestGa4Property,
    },
};
