const express = require('express');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { google } = require('googleapis');
const { config } = require('./config');
const { logger } = require('./logger');
const {
    AdminUser,
    GoogleConnection,
    OauthToken,
    Project,
} = require('./models');
const { getProject } = require('./projects');
const userAuth = require('./userAuth');

const router = express.Router();
const userRouter = express.Router();

const TOKEN_PROVIDER = 'google-oauth';
const GOOGLE_ADS_TOKEN_PROVIDER = 'google-ads-oauth';
const GOOGLE_ALL_TOKEN_PROVIDER = 'google-all-oauth';
const USER_GOOGLE_PROVIDER = 'google-user-oauth';
const USER_GOOGLE_STATE_KIND = 'user_google_connection';
const ADMIN_GOOGLE_STATE_KIND = 'admin_google_connection';
const ADMIN_OAUTH_PROVIDERS = new Set([TOKEN_PROVIDER, GOOGLE_ADS_TOKEN_PROVIDER, GOOGLE_ALL_TOKEN_PROVIDER]);
const GOOGLE_ADS_OAUTH_SCOPE = 'https://www.googleapis.com/auth/adwords';
const frontendUrl = config.frontendUrl.replace(/\/+$/, '');

const oauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
);
const googleAdsOauth2Client = new google.auth.OAuth2(
    config.google.clientId,
    config.google.clientSecret,
    config.google.redirectUri
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

const ALL_SCOPES = [
    ...new Set([...SCOPES, ...GOOGLE_ADS_SCOPES]),
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
        config.google.clientId,
        config.google.clientSecret,
        config.google.redirectUri
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
        userId: String(payload.userId || ''),
        workspaceId: String(payload.workspaceId || ''),
        email: normalizeEmail(payload.email),
        projectId: typeof payload.projectId === 'string' ? payload.projectId.trim() : '',
        redirectPath: normalizePath(payload.redirectPath),
    }, config.jwtSecret, { expiresIn: '15m' });
}

function buildAdminOauthState(provider, user) {
    return jwt.sign({
        kind: ADMIN_GOOGLE_STATE_KIND,
        provider,
        email: normalizeEmail(user?.email),
    }, config.jwtSecret, { expiresIn: '15m' });
}

function parseAdminOauthState(state) {
    if (!state || typeof state !== 'string') {
        return null;
    }

    try {
        const payload = jwt.verify(state, config.jwtSecret);
        if (payload?.kind !== ADMIN_GOOGLE_STATE_KIND || !ADMIN_OAUTH_PROVIDERS.has(payload?.provider)) {
            return null;
        }

        return {
            provider: payload.provider,
            email: normalizeEmail(payload.email),
        };
    } catch {
        return null;
    }
}

// Shared admin tokens power workspace-wide Google API access, so only
// seeded platform admins (ADMIN_EMAIL / ADMIN_EMAILS) may replace them.
async function requirePlatformAdmin(req, res, next) {
    try {
        const email = normalizeEmail(req.user?.email);
        const seededAdmin = email ? await AdminUser.findOne({ email }).lean() : null;
        if (!seededAdmin) {
            return res.status(403).json({ error: 'Platform admin access required' });
        }
        return next();
    } catch (error) {
        logger.error('auth.platform_admin_check_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return res.status(500).json({ error: 'Failed to verify admin access' });
    }
}

function parseUserOauthState(state) {
    if (!state || typeof state !== 'string' || state === TOKEN_PROVIDER || state === GOOGLE_ADS_TOKEN_PROVIDER || state === GOOGLE_ALL_TOKEN_PROVIDER) {
        return null;
    }

    try {
        const payload = jwt.verify(state, config.jwtSecret);
        if (payload?.kind !== USER_GOOGLE_STATE_KIND || !payload?.email || !payload?.workspaceId || !payload?.userId) {
            return null;
        }

        return {
            userId: String(payload.userId),
            workspaceId: String(payload.workspaceId),
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
        }

        if (googleAdsTokenDoc?.tokens) {
            googleAdsOauth2Client.setCredentials(googleAdsTokenDoc.tokens);
        }
    } catch (error) {
        logger.warn('auth.initialize_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

router.get('/login', userAuth.requireAuth, requirePlatformAdmin, (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent',
        state: buildAdminOauthState(TOKEN_PROVIDER, req.user),
    });
    res.redirect(url);
});

router.get('/login/ads', userAuth.requireAuth, requirePlatformAdmin, (req, res) => {
    const url = googleAdsOauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_ADS_SCOPES,
        prompt: 'consent',
        state: buildAdminOauthState(GOOGLE_ADS_TOKEN_PROVIDER, req.user),
    });
    res.redirect(url);
});

router.get('/login/all', userAuth.requireAuth, requirePlatformAdmin, (req, res) => {
    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ALL_SCOPES,
        prompt: 'consent',
        state: buildAdminOauthState(GOOGLE_ALL_TOKEN_PROVIDER, req.user),
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

async function persistUserGoogleConnection(context, tokens) {
    const authClient = createOauthClient();
    authClient.setCredentials(tokens);
    const profile = await fetchGoogleProfile(authClient);

    const connection = await GoogleConnection.findOneAndUpdate(
        {
            workspaceId: context.workspaceId,
            userId: context.userId,
            provider: USER_GOOGLE_PROVIDER,
        },
        {
            workspaceId: context.workspaceId,
            userId: context.userId,
            provider: USER_GOOGLE_PROVIDER,
            label: profile.name || profile.email || context.email,
            googleEmail: profile.email || normalizeEmail(context.email),
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

    if (!code || typeof code !== 'string') {
        res.redirect(buildFrontendRedirect(userOauthState?.redirectPath || '/projects', {
            google: 'error',
            message: 'Google authorization was cancelled or did not return a code',
        }));
        return;
    }

    if (userOauthState) {
        const userClient = createOauthClient();

        try {
            const { tokens } = await userClient.getToken(code);
            userClient.setCredentials(tokens);

            const { connection, profile } = await persistUserGoogleConnection(userOauthState, tokens);

            if (userOauthState.projectId) {
                await Project.findOneAndUpdate(
                    {
                        workspaceId: userOauthState.workspaceId,
                        id: userOauthState.projectId,
                    },
                    {
                        googleConnectionId: connection._id,
                        googleConnectionEmail: connection.googleEmail || userOauthState.email,
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
            logger.error('auth.user_google_connection_failed', {
                error: error instanceof Error ? error.message : String(error),
                workspaceId: userOauthState.workspaceId,
                userId: userOauthState.userId,
            });
            res.redirect(buildFrontendRedirect(userOauthState.redirectPath || '/projects', {
                google: 'error',
                message: 'Failed to connect Google account',
            }));
            return;
        }
    }

    const adminOauthState = parseAdminOauthState(req.query.state);
    if (!adminOauthState) {
        logger.warn('auth.callback_invalid_state', {
            hasState: Boolean(req.query.state),
        });
        res.status(400).send('Invalid or expired OAuth state. Restart the connection from the app.');
        return;
    }

    const requestedProvider = adminOauthState.provider;
    const selectedClient = requestedProvider === GOOGLE_ADS_TOKEN_PROVIDER
        ? googleAdsOauth2Client
        : oauth2Client;

    try {
        const { tokens } = await selectedClient.getToken(code);
        selectedClient.setCredentials(tokens);

        if (requestedProvider === GOOGLE_ALL_TOKEN_PROVIDER) {
            // Store tokens for both providers so all APIs work
            googleAdsOauth2Client.setCredentials(tokens);
            await Promise.all([
                OauthToken.findOneAndUpdate(
                    { provider: TOKEN_PROVIDER },
                    { provider: TOKEN_PROVIDER, tokens, updatedAt: new Date() },
                    { upsert: true, setDefaultsOnInsert: true }
                ),
                OauthToken.findOneAndUpdate(
                    { provider: GOOGLE_ADS_TOKEN_PROVIDER },
                    { provider: GOOGLE_ADS_TOKEN_PROVIDER, tokens, updatedAt: new Date() },
                    { upsert: true, setDefaultsOnInsert: true }
                ),
            ]);
        } else {
            await OauthToken.findOneAndUpdate(
                { provider: requestedProvider },
                { provider: requestedProvider, tokens, updatedAt: new Date() },
                { upsert: true, setDefaultsOnInsert: true }
            );
        }

        res.redirect(`${frontendUrl}?auth=success`);
    } catch (error) {
        logger.error('auth.shared_callback_failed', {
            error: error instanceof Error ? error.message : String(error),
            provider: requestedProvider,
        });
        res.status(500).send('Authentication failed');
    }
});

function getAuthClient() {
    const credentials = oauth2Client.credentials || {};
    if (credentials.access_token || credentials.refresh_token) {
        return oauth2Client;
    }

    if (config.google.disableServiceAccount) {
        return null;
    }

    const serviceAccount = getServiceAccountAuth();
    if (serviceAccount) {
        return serviceAccount;
    }

    return null;
}

async function getUserAuthClient(options = {}) {
    const workspaceId = String(options.workspaceId || '').trim();
    const googleConnectionId = String(options.googleConnectionId || '').trim();
    const userId = String(options.userId || '').trim();
    const email = normalizeEmail(options.email);

    let connection = null;
    if (googleConnectionId) {
        connection = await GoogleConnection.findOne({
            _id: googleConnectionId,
            ...(workspaceId ? { workspaceId } : {}),
        }).lean();
    } else if (workspaceId && userId) {
        connection = await GoogleConnection.findOne({
            workspaceId,
            userId,
            provider: USER_GOOGLE_PROVIDER,
        }).sort({ updatedAt: -1 }).lean();
    } else if (workspaceId && email) {
        connection = await GoogleConnection.findOne({
            workspaceId,
            googleEmail: email,
            provider: USER_GOOGLE_PROVIDER,
        }).sort({ updatedAt: -1 }).lean();
    }

    if (!connection?.tokens) {
        return null;
    }

    const authClient = createOauthClient();
    authClient.setCredentials(connection.tokens);
    return authClient;
}

function resolveProjectAuthSource(project) {
    const googleConnectionId = String(project?.googleConnectionId || '').trim();
    return {
        googleConnectionId,
        allowSharedFallback: false,
    };
}

async function getProjectAuthClient(project) {
    const { googleConnectionId } = resolveProjectAuthSource(project);
    if (!googleConnectionId) {
        return null;
    }

    return getUserAuthClient({
        workspaceId: project.workspaceId,
        googleConnectionId,
    });
}

async function hasProjectAuth(project) {
    return Boolean(await getProjectAuthClient(project));
}

function getStoredOauthTokens() {
    return oauth2Client.credentials || null;
}

function getStoredGoogleAdsOauthTokens() {
    return googleAdsOauth2Client.credentials || null;
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

function getServiceAccountAuth() {
    const keyPath = path.join(__dirname, 'data', 'service_account.json');
    if (fs.existsSync(keyPath)) {
        return new google.auth.GoogleAuth({
            keyFile: keyPath,
            scopes: SERVICE_ACCOUNT_SCOPES,
        });
    }

    return null;
}

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
            googleConnectionId: '',
        };
    }

    return {
        connected: true,
        ownerEmail: '',
        googleEmail: connection.googleEmail || '',
        displayName: connection.displayName || '',
        picture: connection.picture || '',
        scope: connection.scope || '',
        connectedAt: connection.connectedAt || null,
        updatedAt: connection.updatedAt || null,
        googleConnectionId: String(connection._id || ''),
    };
}

async function getConnectionStatus(options = {}) {
    const workspaceId = String(options.workspaceId || '').trim();
    const userId = String(options.userId || '').trim();
    const email = normalizeEmail(options.email);

    if (!workspaceId) {
        return serializeConnectionStatus(null);
    }

    let connection = null;
    if (userId) {
        connection = await GoogleConnection.findOne({
            workspaceId,
            userId,
            provider: USER_GOOGLE_PROVIDER,
        }).sort({ updatedAt: -1 }).lean();
    } else if (email) {
        connection = await GoogleConnection.findOne({
            workspaceId,
            googleEmail: email,
            provider: USER_GOOGLE_PROVIDER,
        }).sort({ updatedAt: -1 }).lean();
    }

    return serializeConnectionStatus(connection);
}

userRouter.get('/connection', async (req, res) => {
    try {
        const status = await getConnectionStatus({
            workspaceId: req.user.workspaceId,
            userId: req.user.userId,
            email: req.user.email,
        });
        res.json(status);
    } catch (error) {
        logger.error('auth.connection_status_failed', {
            error: error instanceof Error ? error.message : String(error),
            workspaceId: req.user.workspaceId,
            userId: req.user.userId,
        });
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
            userId: req.user.userId,
            workspaceId: req.user.workspaceId,
            email: req.user.email,
            projectId,
            redirectPath,
        }),
    });

    res.redirect(url);
});

userRouter.get('/resources', async (req, res) => {
    try {
        const projectId = typeof req.query.projectId === 'string' ? req.query.projectId.trim() : '';
        const project = projectId ? await getProject(projectId, req.user) : null;
        if (projectId && !project) {
            return res.status(404).json({ error: 'Project not found' });
        }

        const authClient = project?.googleConnectionId
            ? await getProjectAuthClient(project)
            : await getUserAuthClient({
                workspaceId: req.user.workspaceId,
                userId: req.user.userId,
                email: req.user.email,
            });
        if (!authClient) {
            return res.status(404).json({ error: 'Google account not connected' });
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
            getConnectionStatus(project?.googleConnectionId
                ? { workspaceId: req.user.workspaceId, email: project.googleConnectionEmail }
                : { workspaceId: req.user.workspaceId, userId: req.user.userId, email: req.user.email }),
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
        logger.error('auth.resources_failed', {
            error: error instanceof Error ? error.message : String(error),
            workspaceId: req.user.workspaceId,
            userId: req.user.userId,
        });
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
        buildAdminOauthState,
        buildProjectRecommendationContext,
        buildUserOauthState,
        parseAdminOauthState,
        collapseComparisonText,
        extractHostname,
        normalizeComparableSiteUrl,
        normalizeComparisonText,
        normalizeEmail,
        normalizePath,
        parseUserOauthState,
        resolveProjectAuthSource,
        serializeConnectionStatus,
        suggestGa4Property,
        suggestSearchConsoleSite,
    },
};
