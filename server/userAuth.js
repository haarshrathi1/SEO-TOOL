const jwt = require('jsonwebtoken');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { AdminUser, Viewer } = require('./models');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const router = express.Router();

function getRequiredJwtSecret(env = process.env) {
    const secret = env.JWT_SECRET?.trim();
    if (!secret) {
        throw new Error('JWT_SECRET is required. Add it to server/.env before starting the server.');
    }
    return secret;
}

const JWT_SECRET = getRequiredJwtSecret();

const GOOGLE_CLIENT_ID = process.env.CLIENT_ID;
const TOKEN_EXPIRY = '7d';
const DEV_ADMIN_BYPASS = /^(1|true|yes|on)$/i.test(process.env.DEV_ADMIN_BYPASS || '');
const ALLOWED_ACCESS = new Set(['keywords', 'dashboard', 'audit']);
const ALLOWED_FEATURES = new Set(['keyword_ads']);
const DEFAULT_VIEWER_ACCESS = ['keywords'];
const DEFAULT_SELF_SERVICE_ACCESS = ['keywords', 'dashboard', 'audit'];
const DEFAULT_VIEWER_FEATURES = [];
const SELF_SERVICE_REGISTRATION_SOURCE = 'google_self_service';

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function normalizeEmail(value) {
    return typeof value === 'string' ? value.toLowerCase().trim() : '';
}

function normalizeProjectIds(projectIds) {
    if (!Array.isArray(projectIds)) return [];
    return [...new Set(projectIds.map((projectId) => String(projectId || '').trim()).filter(Boolean))];
}

function normalizeAccess(access) {
    if (!Array.isArray(access) || access.length === 0) {
        return [...DEFAULT_VIEWER_ACCESS];
    }

    const normalized = [...new Set(access.map((entry) => String(entry || '').trim()).filter((entry) => ALLOWED_ACCESS.has(entry)))];
    return normalized.length > 0 ? normalized : [...DEFAULT_VIEWER_ACCESS];
}

function normalizeFeatures(features) {
    if (!Array.isArray(features) || features.length === 0) {
        return [...DEFAULT_VIEWER_FEATURES];
    }

    return [...new Set(features.map((entry) => String(entry || '').trim()).filter((entry) => ALLOWED_FEATURES.has(entry)))];
}

function extractHostname(value) {
    if (!value) return '';

    try {
        return new URL(value).hostname.toLowerCase();
    } catch {
        return value.split(',')[0].trim().split(':')[0].toLowerCase();
    }
}

function isLocalHostname(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function isLocalRequest(req) {
    const candidates = [
        req.get('origin'),
        req.get('referer'),
        req.get('host'),
        req.get('x-forwarded-host'),
    ].filter(Boolean);

    return candidates.some((value) => isLocalHostname(extractHostname(value)));
}

function shouldBypassAdmin(req) {
    return DEV_ADMIN_BYPASS && isLocalRequest(req);
}

function getCookieOptions() {
    const isProd = process.env.NODE_ENV === 'production';
    return {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000,
        path: '/',
    };
}

function getSeedAdminEmails() {
    return [...new Set(
        [process.env.ADMIN_EMAIL, ...(process.env.ADMIN_EMAILS || '').split(',')]
            .map(normalizeEmail)
            .filter(Boolean)
    )];
}

function getPublicViewer(viewer, tokenPayload = {}) {
    return {
        email: viewer.email,
        role: 'viewer',
        name: viewer.displayName || tokenPayload.name || viewer.email,
        picture: viewer.picture || tokenPayload.picture || '',
        access: normalizeAccess(viewer.access),
        features: normalizeFeatures(viewer.features),
        projectIds: normalizeProjectIds(viewer.projectIds),
        registrationSource: viewer.registrationSource || null,
        status: viewer.status || 'active',
        createdAt: viewer.createdAt || null,
        registeredAt: viewer.registeredAt || null,
        lastLoginAt: viewer.lastLoginAt || null,
    };
}

async function initializeUserAccess() {
    const seedAdminEmails = getSeedAdminEmails();
    const adminCount = await AdminUser.countDocuments({});

    if (adminCount === 0 && seedAdminEmails.length === 0) {
        throw new Error('Configure ADMIN_EMAIL or ADMIN_EMAILS, or create an AdminUser record before starting the server.');
    }

    if (seedAdminEmails.length === 0) {
        return;
    }

    await Promise.all(seedAdminEmails.map((email) => AdminUser.findOneAndUpdate(
        { email },
        { email },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )));
}

async function isAdminEmail(email) {
    if (!email) return false;
    const admin = await AdminUser.findOne({ email: normalizeEmail(email) }).lean();
    return Boolean(admin);
}

function buildAdminUser(email, tokenPayload = {}) {
    return {
        email,
        role: 'admin',
        name: tokenPayload.name || email,
        picture: tokenPayload.picture || '',
        access: ['keywords', 'dashboard', 'audit'],
        features: ['keyword_ads'],
        projectIds: [],
    };
}

function buildViewerSessionPayload(viewer, tokenPayload = {}) {
    const name = tokenPayload.name || viewer?.displayName || viewer?.email || '';
    const picture = tokenPayload.picture || viewer?.picture || '';
    return {
        email: viewer.email,
        role: 'viewer',
        name,
        picture,
    };
}

function issueSession(res, payload, user) {
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
    res.cookie('seo_token', token, getCookieOptions());
    return res.json({ user });
}

function resolveLoginRole({ adminAllowed, viewerExists, allowDevAdmin }) {
    if (adminAllowed) {
        return 'admin';
    }

    if (viewerExists) {
        return 'viewer';
    }

    if (allowDevAdmin) {
        return 'admin';
    }

    return null;
}

function resolveFreshRole({ tokenRole, adminAllowed, viewerExists, allowDevAdmin }) {
    if (adminAllowed) {
        return 'admin';
    }

    if (viewerExists) {
        return 'viewer';
    }

    if (tokenRole === 'admin' && allowDevAdmin) {
        return 'admin';
    }

    return null;
}

async function loadFreshUser(decoded, req) {
    const email = normalizeEmail(decoded.email);
    if (!email) {
        return null;
    }

    const adminAllowed = await isAdminEmail(email);
    const viewer = adminAllowed ? null : await Viewer.findOne({ email }).lean();
    const role = resolveFreshRole({
        tokenRole: decoded.role,
        adminAllowed,
        viewerExists: Boolean(viewer),
        allowDevAdmin: shouldBypassAdmin(req),
    });

    if (role === 'admin') {
        return buildAdminUser(email, decoded);
    }

    if (role === 'viewer' && viewer) {
        return getPublicViewer(viewer, decoded);
    }

    return null;
}

async function verifyGoogleCredential(credential) {
    const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    return {
        payload,
        email: normalizeEmail(payload?.email),
        name: payload?.name || normalizeEmail(payload?.email),
        picture: payload?.picture || '',
    };
}

async function upsertViewerLoginProfile(email, tokenPayload = {}, defaults = {}) {
    const update = {
        displayName: tokenPayload.name || defaults.displayName || '',
        picture: tokenPayload.picture || defaults.picture || '',
        lastLoginAt: new Date(),
    };

    if (defaults.registrationSource) {
        update.registrationSource = defaults.registrationSource;
    }

    if (defaults.status) {
        update.status = defaults.status;
    }

    if (defaults.registeredAt) {
        update.registeredAt = defaults.registeredAt;
    }

    if (defaults.access) {
        update.access = normalizeAccess(defaults.access);
    }

    if (defaults.features) {
        update.features = normalizeFeatures(defaults.features);
    }

    if (defaults.projectIds) {
        update.projectIds = normalizeProjectIds(defaults.projectIds);
    }

    const viewer = await Viewer.findOneAndUpdate(
        { email },
        { $set: update },
        { new: true }
    ).lean();

    return viewer;
}

async function requireAuth(req, res, next) {
    const token = req.cookies?.seo_token || null;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const user = await loadFreshUser(decoded, req);
        if (!user) {
            return res.status(403).json({ error: 'Access revoked or no longer authorized' });
        }

        req.user = user;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }
}

function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

function resolveProjectId(req) {
    const sources = [req.body?.projectId, req.query?.projectId, req.params?.projectId];
    const projectId = sources.find((value) => typeof value === 'string' && value.trim());
    return projectId ? projectId.trim() : null;
}

function requireAccess(accessName) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (req.user.role === 'admin') {
            return next();
        }

        if (!Array.isArray(req.user.access) || !req.user.access.includes(accessName)) {
            return res.status(403).json({ error: `${accessName} access required` });
        }

        const projectId = resolveProjectId(req);
        if (projectId) {
            const projectIds = Array.isArray(req.user.projectIds) ? req.user.projectIds : [];
            if (!projectIds.length || !projectIds.includes(projectId)) {
                return res.status(403).json({ error: 'Project access required' });
            }
        }

        return next();
    };
}

router.post('/google-login', async (req, res) => {
    const { credential } = req.body;
    if (!credential) {
        return res.status(400).json({ error: 'Google credential required' });
    }

    try {
        const { payload, email, name, picture } = await verifyGoogleCredential(credential);
        const adminAllowed = await isAdminEmail(email);
        const viewer = adminAllowed ? null : await Viewer.findOne({ email }).lean();
        const role = resolveLoginRole({
            adminAllowed,
            viewerExists: Boolean(viewer),
            allowDevAdmin: shouldBypassAdmin(req),
        });

        if (role === 'admin') {
            return issueSession(
                res,
                { email, role: 'admin', name, picture },
                buildAdminUser(email, { name, picture })
            );
        }

        if (role === 'viewer' && viewer) {
            const refreshedViewer = await upsertViewerLoginProfile(email, { name, picture });
            const user = getPublicViewer(refreshedViewer || viewer, { name, picture });
            return issueSession(
                res,
                buildViewerSessionPayload(refreshedViewer || viewer, { name, picture }),
                user
            );
        }

        return res.status(403).json({ error: 'Access denied. Your email is not authorized. Contact the admin.' });
    } catch (e) {
        console.error('Google login error:', e.message);
        return res.status(401).json({ error: 'Invalid Google credential' });
    }
});

router.post('/register', async (req, res) => {
    const { credential } = req.body;
    if (!credential) {
        return res.status(400).json({ error: 'Google credential required' });
    }

    try {
        const { email, name, picture } = await verifyGoogleCredential(credential);
        const adminAllowed = await isAdminEmail(email);

        if (adminAllowed) {
            return issueSession(
                res,
                { email, role: 'admin', name, picture },
                buildAdminUser(email, { name, picture })
            );
        }

        let viewer = await Viewer.findOne({ email }).lean();
        if (!viewer) {
            viewer = await Viewer.create({
                email,
                access: normalizeAccess(DEFAULT_SELF_SERVICE_ACCESS),
                features: normalizeFeatures(DEFAULT_VIEWER_FEATURES),
                projectIds: [],
                registrationSource: SELF_SERVICE_REGISTRATION_SOURCE,
                status: 'active',
                displayName: name,
                picture,
                registeredAt: new Date(),
                lastLoginAt: new Date(),
                createdAt: new Date(),
            });
            viewer = typeof viewer.toObject === 'function' ? viewer.toObject() : viewer;
        } else {
            viewer = await upsertViewerLoginProfile(email, { name, picture }, {
                access: DEFAULT_SELF_SERVICE_ACCESS,
            });
        }

        const user = getPublicViewer(viewer, { name, picture });
        return issueSession(
            res,
            buildViewerSessionPayload(viewer, { name, picture }),
            user
        );
    } catch (error) {
        console.error('Google registration error:', error.message);
        return res.status(401).json({ error: 'Invalid Google credential' });
    }
});

router.get('/config', (req, res) => {
    res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

router.post('/logout', (req, res) => {
    const isProd = process.env.NODE_ENV === 'production';
    res.clearCookie('seo_token', {
        httpOnly: true,
        secure: isProd,
        sameSite: isProd ? 'none' : 'lax',
        path: '/',
    });
    res.json({ message: 'Logged out' });
});

router.post('/viewers', requireAuth, requireAdmin, async (req, res) => {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!normalizedEmail) {
        return res.status(400).json({ error: 'Email required' });
    }

    if (await isAdminEmail(normalizedEmail)) {
        return res.status(400).json({ error: 'Admin email cannot be added as viewer' });
    }

    try {
        const existing = await Viewer.findOne({ email: normalizedEmail }).lean();
        if (existing) {
            return res.status(400).json({ error: 'Viewer already exists' });
        }

        const newViewer = await Viewer.create({
            email: normalizedEmail,
            access: normalizeAccess(req.body.access),
            features: normalizeFeatures(req.body.features),
            projectIds: normalizeProjectIds(req.body.projectIds),
            createdAt: new Date(),
            status: 'active',
        });

        res.json({
            message: 'Viewer added',
            viewer: getPublicViewer(newViewer.toObject ? newViewer.toObject() : newViewer),
        });
    } catch (e) {
        console.error('Failed to add viewer:', e.message);
        res.status(500).json({ error: 'Failed to add viewer' });
    }
});

router.put('/viewers/:email', requireAuth, requireAdmin, async (req, res) => {
    const targetEmail = normalizeEmail(decodeURIComponent(req.params.email));
    if (!targetEmail) {
        return res.status(400).json({ error: 'Viewer email is required' });
    }

    try {
        const viewer = await Viewer.findOneAndUpdate(
            { email: targetEmail },
            {
                access: normalizeAccess(req.body.access),
                features: normalizeFeatures(req.body.features),
                projectIds: normalizeProjectIds(req.body.projectIds),
            },
            { new: true }
        ).lean();

        if (!viewer) {
            return res.status(404).json({ error: 'Viewer not found' });
        }

        return res.json({
            message: 'Viewer updated',
            viewer: getPublicViewer(viewer),
        });
    } catch (e) {
        console.error('Failed to update viewer:', e.message);
        return res.status(500).json({ error: 'Failed to update viewer' });
    }
});

router.get('/viewers', requireAuth, requireAdmin, async (req, res) => {
    try {
        const viewers = await Viewer.find({}).sort({ createdAt: -1 }).lean();
        res.json(viewers.map((viewer) => getPublicViewer(viewer)));
    } catch (e) {
        console.error('Failed to list viewers:', e.message);
        res.status(500).json({ error: 'Failed to list viewers' });
    }
});

router.delete('/viewers/:email', requireAuth, requireAdmin, async (req, res) => {
    const targetEmail = normalizeEmail(decodeURIComponent(req.params.email));

    try {
        const result = await Viewer.deleteOne({ email: targetEmail });
        if (!result.deletedCount) {
            return res.status(404).json({ error: 'Viewer not found' });
        }

        res.json({ message: 'Viewer removed' });
    } catch (e) {
        console.error('Failed to delete viewer:', e.message);
        res.status(500).json({ error: 'Failed to remove viewer' });
    }
});

module.exports = {
    router,
    requireAuth,
    requireAdmin,
    requireAccess,
    initializeUserAccess,
    __internal: {
        normalizeEmail,
        normalizeProjectIds,
        normalizeAccess,
        normalizeFeatures,
        DEFAULT_SELF_SERVICE_ACCESS,
        resolveProjectId,
        getRequiredJwtSecret,
        shouldBypassAdmin,
        buildAdminUser,
        buildViewerSessionPayload,
        resolveLoginRole,
        resolveFreshRole,
        verifyGoogleCredential,
        upsertViewerLoginProfile,
    },
};

