const crypto = require('crypto');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { config } = require('./config');
const { logger } = require('./logger');
const { recordAuditEvent } = require('./auditEvents');
const {
    AdminUser,
    Session,
    User,
    Workspace,
    WorkspaceMembership,
} = require('./models');

const router = express.Router();

const ALLOWED_ACCESS = new Set(['keywords', 'dashboard', 'audit']);
const ALLOWED_FEATURES = new Set(['keyword_ads']);
const DEFAULT_VIEWER_ACCESS = ['keywords'];
const DEFAULT_SELF_SERVICE_ACCESS = ['keywords', 'dashboard', 'audit'];
const DEFAULT_VIEWER_FEATURES = [];
const DEFAULT_OWNER_FEATURES = ['keyword_ads'];
const SELF_SERVICE_REGISTRATION_SOURCE = 'google_self_service';
const SESSION_TTL_MS = config.session.maxAgeMs;
const SESSION_COOKIE_NAME = config.session.cookieName;
const SESSION_CSRF_HEADER = config.security.csrfHeaderName;
const WORKSPACE_MANAGER_ROLES = new Set(['owner', 'admin']);
const VIEWER_ROLE = 'viewer';
const googleClient = new OAuth2Client(config.google.clientId);

function getRequiredJwtSecret(env = process.env) {
    const secret = env.JWT_SECRET?.trim();
    if (!secret) {
        throw new Error('JWT_SECRET is required. Add it to server/.env before starting the server.');
    }
    return secret;
}

function normalizeEmail(value) {
    return typeof value === 'string' ? value.toLowerCase().trim() : '';
}

function normalizeProjectIds(projectIds) {
    if (!Array.isArray(projectIds)) return [];
    return [...new Set(projectIds.map((projectId) => String(projectId || '').trim()).filter(Boolean))];
}

function normalizeAccess(access, fallback = DEFAULT_VIEWER_ACCESS) {
    if (!Array.isArray(access) || access.length === 0) {
        return [...fallback];
    }

    const normalized = [...new Set(access.map((entry) => String(entry || '').trim()).filter((entry) => ALLOWED_ACCESS.has(entry)))];
    return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeFeatures(features) {
    if (!Array.isArray(features) || features.length === 0) {
        return [...DEFAULT_VIEWER_FEATURES];
    }

    return [...new Set(features.map((entry) => String(entry || '').trim()).filter((entry) => ALLOWED_FEATURES.has(entry)))];
}

function normalizeWorkspaceName(value, fallbackEmail) {
    const trimmed = typeof value === 'string' ? value.trim() : '';
    if (trimmed) {
        return trimmed;
    }

    const email = normalizeEmail(fallbackEmail);
    if (!email) {
        return 'SEO Workspace';
    }

    const localPart = email.split('@')[0] || 'workspace';
    return `${localPart.replace(/[^a-z0-9]+/gi, ' ').trim() || 'SEO'} Workspace`;
}

function slugify(value) {
    const slug = String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    return slug || 'workspace';
}

async function buildUniqueWorkspaceSlug(name, email) {
    const base = slugify(name || email || 'workspace');
    let candidate = base;
    let attempt = 0;

    while (attempt < 20) {
        // eslint-disable-next-line no-await-in-loop
        const existing = await Workspace.findOne({ slug: candidate }).lean();
        if (!existing) {
            return candidate;
        }

        attempt += 1;
        candidate = `${base}-${attempt + 1}`;
    }

    return `${base}-${Date.now()}`;
}

function generateSecretToken(bytes = 32) {
    return crypto.randomBytes(bytes).toString('hex');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function getCookieOptions() {
    return {
        httpOnly: true,
        secure: config.isProduction,
        sameSite: 'lax',
        maxAge: SESSION_TTL_MS,
        path: '/',
    };
}

function isWorkspaceManager(user) {
    if (!user) {
        return false;
    }

    if (user.workspaceRole) {
        return WORKSPACE_MANAGER_ROLES.has(user.workspaceRole);
    }

    return user.role === 'admin';
}

function getClientRoleForMembership(role) {
    return role === VIEWER_ROLE ? 'viewer' : 'admin';
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

function resolveProjectId(req) {
    const sources = [req.body?.projectId, req.query?.projectId, req.params?.projectId];
    const projectId = sources.find((value) => typeof value === 'string' && value.trim());
    return projectId ? projectId.trim() : null;
}

function getPublicMembershipUser({ user, workspace, membership }) {
    return {
        email: user.email,
        role: getClientRoleForMembership(membership.role),
        workspaceRole: membership.role,
        workspaceId: workspace._id?.toString?.() || String(workspace._id || ''),
        workspaceSlug: workspace.slug,
        workspaceName: workspace.name,
        userId: user._id?.toString?.() || String(user._id || ''),
        name: user.displayName || user.email,
        picture: user.picture || '',
        access: normalizeAccess(membership.access, membership.role === VIEWER_ROLE ? DEFAULT_VIEWER_ACCESS : DEFAULT_SELF_SERVICE_ACCESS),
        features: normalizeFeatures(membership.features),
        projectIds: normalizeProjectIds(membership.projectIds),
        registrationSource: user.registrationSource || null,
        status: membership.status || user.status || 'active',
        createdAt: user.createdAt || null,
        registeredAt: user.registeredAt || null,
        lastLoginAt: user.lastLoginAt || null,
    };
}

function getPublicViewerMembership({ user, membership }) {
    return {
        email: user.email,
        role: 'viewer',
        workspaceRole: membership.role,
        name: user.displayName || user.email,
        picture: user.picture || '',
        access: normalizeAccess(membership.access),
        features: normalizeFeatures(membership.features),
        projectIds: normalizeProjectIds(membership.projectIds),
        registrationSource: user.registrationSource || null,
        status: membership.status || user.status || 'active',
        createdAt: user.createdAt || null,
        registeredAt: user.registeredAt || null,
        lastLoginAt: user.lastLoginAt || null,
    };
}

function buildMembershipDefaults(role, overrides = {}) {
    const access = normalizeAccess(
        overrides.access,
        role === VIEWER_ROLE ? DEFAULT_VIEWER_ACCESS : DEFAULT_SELF_SERVICE_ACCESS,
    );
    const features = normalizeFeatures(overrides.features || (role === 'owner' ? DEFAULT_OWNER_FEATURES : []));

    return {
        role,
        access,
        features,
        projectIds: normalizeProjectIds(overrides.projectIds),
        status: overrides.status || 'active',
    };
}

function buildSessionResponse(userSummary, csrfToken) {
    return {
        user: userSummary,
        csrfToken,
    };
}

async function verifyGoogleCredential(credential) {
    const ticket = await googleClient.verifyIdToken({
        idToken: credential,
        audience: config.google.clientId,
    });

    const payload = ticket.getPayload();
    return {
        payload,
        email: normalizeEmail(payload?.email),
        name: payload?.name || normalizeEmail(payload?.email),
        picture: payload?.picture || '',
    };
}

async function upsertUserProfile(email, tokenPayload = {}, defaults = {}) {
    const normalizedEmail = normalizeEmail(email);
    const update = {
        email: normalizedEmail,
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

    const user = await User.findOneAndUpdate(
        { email: normalizedEmail },
        {
            $set: update,
            $setOnInsert: {
                createdAt: new Date(),
            },
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return user;
}

async function getWorkspaceForMembership(membership) {
    if (!membership?.workspaceId) {
        return null;
    }

    return Workspace.findById(membership.workspaceId).lean();
}

async function getPrimaryMembershipForUser(userId) {
    const memberships = await WorkspaceMembership.find({
        userId,
        status: { $ne: 'revoked' },
    }).sort({ role: 1, createdAt: 1 }).lean();

    if (!memberships.length) {
        return null;
    }

    const ownerMembership = memberships.find((membership) => membership.role === 'owner');
    return ownerMembership || memberships[0];
}

async function createWorkspaceForUser(user, options = {}) {
    const workspaceName = normalizeWorkspaceName(options.workspaceName, user.email);
    const slug = await buildUniqueWorkspaceSlug(workspaceName, user.email);
    const workspace = await Workspace.create({
        name: workspaceName,
        slug,
        ownerUserId: user._id,
    });

    const membership = await WorkspaceMembership.create({
        workspaceId: workspace._id,
        userId: user._id,
        ...buildMembershipDefaults('owner', {
            access: DEFAULT_SELF_SERVICE_ACCESS,
            features: DEFAULT_OWNER_FEATURES,
        }),
    });

    return {
        workspace: workspace.toObject ? workspace.toObject() : workspace,
        membership: membership.toObject ? membership.toObject() : membership,
    };
}

async function ensureAdminBootstrapWorkspace(email, tokenPayload = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        return null;
    }

    const user = await upsertUserProfile(normalizedEmail, tokenPayload, {
        registrationSource: 'admin_bootstrap',
        status: 'active',
        registeredAt: new Date(),
    });

    let membership = await getPrimaryMembershipForUser(user._id);
    let workspace = membership ? await getWorkspaceForMembership(membership) : null;

    if (!membership || !workspace) {
        const created = await createWorkspaceForUser(user, {
            workspaceName: normalizeWorkspaceName(tokenPayload.name, normalizedEmail),
        });
        membership = created.membership;
        workspace = created.workspace;
    }

    if (membership.role !== 'owner') {
        membership = await WorkspaceMembership.findOneAndUpdate(
            { _id: membership._id },
            {
                role: 'owner',
                access: DEFAULT_SELF_SERVICE_ACCESS,
                features: DEFAULT_OWNER_FEATURES,
                status: 'active',
            },
            { new: true }
        ).lean();
    }

    return {
        user: user.toObject ? user.toObject() : user,
        workspace,
        membership,
    };
}

async function loadUserContextByMembership(membership) {
    if (!membership) {
        return null;
    }

    const [user, workspace] = await Promise.all([
        User.findById(membership.userId).lean(),
        Workspace.findById(membership.workspaceId).lean(),
    ]);

    if (!user || !workspace) {
        return null;
    }

    return { user, workspace, membership };
}

async function resolveLoginContext(email, tokenPayload = {}, options = {}) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail) {
        return null;
    }

    const [adminRecord, existingUser] = await Promise.all([
        AdminUser.findOne({ email: normalizedEmail }).lean(),
        User.findOne({ email: normalizedEmail }).lean(),
    ]);

    if (adminRecord) {
        return ensureAdminBootstrapWorkspace(normalizedEmail, tokenPayload);
    }

    if (!existingUser) {
        if (!options.allowRegistration) {
            return null;
        }

        const user = await upsertUserProfile(normalizedEmail, tokenPayload, {
            registrationSource: SELF_SERVICE_REGISTRATION_SOURCE,
            status: 'active',
            registeredAt: new Date(),
        });
        return createWorkspaceForUser(user, {
            workspaceName: normalizeWorkspaceName(options.workspaceName || tokenPayload.name, normalizedEmail),
        }).then(({ workspace, membership }) => ({
            user: user.toObject ? user.toObject() : user,
            workspace,
            membership,
        }));
    }

    const refreshedUser = await upsertUserProfile(normalizedEmail, tokenPayload);
    let membership = await getPrimaryMembershipForUser(existingUser._id);
    let workspace = membership ? await getWorkspaceForMembership(membership) : null;

    if (!membership || !workspace) {
        if (!options.allowRegistration) {
            return null;
        }

        const created = await createWorkspaceForUser(refreshedUser, {
            workspaceName: normalizeWorkspaceName(options.workspaceName || tokenPayload.name, normalizedEmail),
        });
        membership = created.membership;
        workspace = created.workspace;
    }

    return {
        user: refreshedUser.toObject ? refreshedUser.toObject() : refreshedUser,
        workspace,
        membership,
    };
}

async function issueSession(res, req, context) {
    const rawToken = generateSecretToken(48);
    const csrfToken = generateSecretToken(24);
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await Session.create({
        tokenHash: hashToken(rawToken),
        csrfToken,
        userId: context.user._id,
        workspaceId: context.workspace._id,
        userAgent: req.get('user-agent') || '',
        ipAddress: req.ip || '',
        expiresAt,
        lastSeenAt: new Date(),
    });

    const userSummary = getPublicMembershipUser(context);
    res.cookie(SESSION_COOKIE_NAME, rawToken, getCookieOptions());
    return res.json(buildSessionResponse(userSummary, csrfToken));
}

async function revokeSessionByToken(token) {
    if (!token) {
        return;
    }

    await Session.deleteOne({ tokenHash: hashToken(token) });
}

async function loadSessionContext(req) {
    const rawToken = req.cookies?.[SESSION_COOKIE_NAME];
    if (!rawToken) {
        return null;
    }

    const session = await Session.findOne({
        tokenHash: hashToken(rawToken),
        expiresAt: { $gt: new Date() },
    }).lean();

    if (!session) {
        return null;
    }

    const membership = await WorkspaceMembership.findOne({
        workspaceId: session.workspaceId,
        userId: session.userId,
        status: { $ne: 'revoked' },
    }).lean();

    if (!membership) {
        await Session.deleteOne({ _id: session._id });
        return null;
    }

    const context = await loadUserContextByMembership(membership);
    if (!context) {
        await Session.deleteOne({ _id: session._id });
        return null;
    }

    void Session.updateOne(
        { _id: session._id },
        { $set: { lastSeenAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) } }
    ).catch((error) => {
        logger.warn('session.touch_failed', {
            error: error instanceof Error ? error.message : String(error),
            sessionId: session._id?.toString?.() || String(session._id || ''),
        });
    });

    return {
        session,
        ...context,
    };
}

async function initializeUserAccess() {
    const seedAdminEmails = [...new Set(
        [config.admin.email, ...config.admin.emails]
            .map(normalizeEmail)
            .filter(Boolean)
    )];

    if (seedAdminEmails.length === 0) {
        return;
    }

    await Promise.all(seedAdminEmails.map((email) => AdminUser.findOneAndUpdate(
        { email },
        { email },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    )));

    await Promise.all(seedAdminEmails.map((email) => ensureAdminBootstrapWorkspace(email, {
        name: email.split('@')[0],
        picture: '',
    })));
}

async function requireAuth(req, res, next) {
    const context = await loadSessionContext(req);
    if (!context) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    req.session = context.session;
    req.user = getPublicMembershipUser(context);
    req.userContext = context;
    return next();
}

function requireAdmin(req, res, next) {
    if (!isWorkspaceManager(req.user)) {
        return res.status(403).json({ error: 'Workspace admin access required' });
    }
    return next();
}

function requireAccess(accessName) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ error: 'Authentication required' });
        }

        if (req.user.role === 'admin' && !req.user.workspaceRole) {
            return next();
        }

        if (!Array.isArray(req.user.access) || !req.user.access.includes(accessName)) {
            return res.status(403).json({ error: `${accessName} access required` });
        }

        const projectId = resolveProjectId(req);
        const effectiveRole = req.user.workspaceRole || req.user.role;
        if (projectId && effectiveRole === VIEWER_ROLE) {
            const projectIds = Array.isArray(req.user.projectIds) ? req.user.projectIds : [];
            if (!projectIds.length || !projectIds.includes(projectId)) {
                return res.status(403).json({ error: 'Project access required' });
            }
        }

        return next();
    };
}

const CSRF_SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requireCsrf(req, res, next) {
    if (CSRF_SAFE_METHODS.has(req.method)) {
        return next();
    }

    if (!req.session) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    const provided = req.get(SESSION_CSRF_HEADER) || req.body?._csrf || '';
    const expected = req.session.csrfToken || '';
    const providedBuffer = Buffer.from(String(provided));
    const expectedBuffer = Buffer.from(String(expected));
    const matches = providedBuffer.length === expectedBuffer.length
        && expectedBuffer.length > 0
        && crypto.timingSafeEqual(providedBuffer, expectedBuffer);
    if (!matches) {
        return res.status(403).json({ error: 'Invalid CSRF token' });
    }

    return next();
}

router.post('/google-login', async (req, res) => {
    const { credential } = req.body;
    if (!credential) {
        return res.status(400).json({ error: 'Google credential required' });
    }

    try {
        const { email, name, picture } = await verifyGoogleCredential(credential);
        const context = await resolveLoginContext(email, { name, picture }, { allowRegistration: false });
        if (!context) {
            return res.status(403).json({ error: 'Access denied. Your email is not authorized for any workspace.' });
        }

        await recordAuditEvent({
            workspaceId: context.workspace._id,
            userId: context.user._id,
            action: 'auth.login',
            entityType: 'session',
            entityId: email,
            metadata: { provider: 'google' },
        });

        return issueSession(res, req, context);
    } catch (error) {
        logger.warn('auth.google_login_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return res.status(401).json({ error: 'Invalid Google credential' });
    }
});

router.post('/register', async (req, res) => {
    if (!config.security.allowSelfRegistration) {
        return res.status(403).json({ error: 'Self-service registration is disabled on this server. Ask an administrator for access.' });
    }

    const { credential, workspaceName } = req.body;
    if (!credential) {
        return res.status(400).json({ error: 'Google credential required' });
    }

    try {
        const { email, name, picture } = await verifyGoogleCredential(credential);
        const context = await resolveLoginContext(email, { name, picture }, {
            allowRegistration: true,
            workspaceName,
        });

        await recordAuditEvent({
            workspaceId: context.workspace._id,
            userId: context.user._id,
            action: 'auth.register',
            entityType: 'workspace',
            entityId: context.workspace._id?.toString?.() || '',
            metadata: { provider: 'google' },
        });

        return issueSession(res, req, context);
    } catch (error) {
        logger.warn('auth.google_register_failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return res.status(401).json({ error: 'Invalid Google credential' });
    }
});

router.get('/config', (req, res) => {
    res.json({
        googleClientId: config.google.clientId,
        allowRegistration: config.security.allowSelfRegistration,
    });
});

router.get('/session', requireAuth, (req, res) => {
    res.json(buildSessionResponse(req.user, req.session.csrfToken));
});

router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

router.get('/csrf', requireAuth, (req, res) => {
    res.json({ csrfToken: req.session.csrfToken });
});

router.post('/logout', requireAuth, requireCsrf, async (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE_NAME] || null;
    await revokeSessionByToken(token);
    res.clearCookie(SESSION_COOKIE_NAME, getCookieOptions());
    res.json({ message: 'Logged out' });
});

router.get('/workspaces/current', requireAuth, (req, res) => {
    res.json({
        workspace: {
            id: req.user.workspaceId,
            slug: req.user.workspaceSlug,
            name: req.user.workspaceName,
            role: req.user.workspaceRole,
        },
    });
});

router.get('/workspaces/current/members', requireAuth, requireAdmin, async (req, res) => {
    const memberships = await WorkspaceMembership.find({
        workspaceId: req.user.workspaceId,
        status: { $ne: 'revoked' },
    }).lean();

    const users = await User.find({
        _id: { $in: memberships.map((membership) => membership.userId) },
    }).lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));

    const members = memberships.map((membership) => {
        const user = usersById.get(String(membership.userId));
        if (!user) {
            return null;
        }

        return {
            email: user.email,
            name: user.displayName || user.email,
            picture: user.picture || '',
            role: membership.role,
            access: normalizeAccess(membership.access, membership.role === VIEWER_ROLE ? DEFAULT_VIEWER_ACCESS : DEFAULT_SELF_SERVICE_ACCESS),
            features: normalizeFeatures(membership.features),
            projectIds: normalizeProjectIds(membership.projectIds),
            status: membership.status || 'active',
            createdAt: membership.createdAt || null,
            updatedAt: membership.updatedAt || null,
        };
    }).filter(Boolean);

    res.json({ items: members });
});

router.post('/viewers', requireAuth, requireAdmin, requireCsrf, async (req, res) => {
    const normalizedEmail = normalizeEmail(req.body.email);
    if (!normalizedEmail) {
        return res.status(400).json({ error: 'Email required' });
    }

    try {
        const user = await upsertUserProfile(normalizedEmail, {}, {
            status: 'active',
        });
        const membership = await WorkspaceMembership.findOneAndUpdate(
            {
                workspaceId: req.user.workspaceId,
                userId: user._id,
            },
            {
                workspaceId: req.user.workspaceId,
                userId: user._id,
                ...buildMembershipDefaults(VIEWER_ROLE, {
                    access: req.body.access,
                    features: req.body.features,
                    projectIds: req.body.projectIds,
                }),
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        ).lean();

        await recordAuditEvent({
            workspaceId: req.user.workspaceId,
            userId: req.user.userId,
            action: 'workspace.member_added',
            entityType: 'membership',
            entityId: membership._id?.toString?.() || '',
            metadata: { email: normalizedEmail, role: VIEWER_ROLE },
        });

        return res.json({
            message: 'Viewer added',
            viewer: getPublicViewerMembership({
                user: user.toObject ? user.toObject() : user,
                membership,
            }),
        });
    } catch (error) {
        logger.error('workspace.add_viewer_failed', {
            error: error instanceof Error ? error.message : String(error),
            email: normalizedEmail,
        });
        return res.status(500).json({ error: 'Failed to add viewer' });
    }
});

router.put('/viewers/:email', requireAuth, requireAdmin, requireCsrf, async (req, res) => {
    const targetEmail = normalizeEmail(decodeURIComponent(req.params.email));
    if (!targetEmail) {
        return res.status(400).json({ error: 'Viewer email is required' });
    }

    try {
        const user = await User.findOne({ email: targetEmail }).lean();
        if (!user) {
            return res.status(404).json({ error: 'Viewer not found' });
        }

        const membership = await WorkspaceMembership.findOneAndUpdate(
            {
                workspaceId: req.user.workspaceId,
                userId: user._id,
            },
            {
                role: VIEWER_ROLE,
                access: normalizeAccess(req.body.access),
                features: normalizeFeatures(req.body.features),
                projectIds: normalizeProjectIds(req.body.projectIds),
                status: 'active',
            },
            { new: true }
        ).lean();

        if (!membership) {
            return res.status(404).json({ error: 'Viewer not found' });
        }

        await recordAuditEvent({
            workspaceId: req.user.workspaceId,
            userId: req.user.userId,
            action: 'workspace.member_updated',
            entityType: 'membership',
            entityId: membership._id?.toString?.() || '',
            metadata: { email: targetEmail, role: VIEWER_ROLE },
        });

        return res.json({
            message: 'Viewer updated',
            viewer: getPublicViewerMembership({ user, membership }),
        });
    } catch (error) {
        logger.error('workspace.update_viewer_failed', {
            error: error instanceof Error ? error.message : String(error),
            email: targetEmail,
        });
        return res.status(500).json({ error: 'Failed to update viewer' });
    }
});

router.get('/viewers', requireAuth, requireAdmin, async (req, res) => {
    try {
        const memberships = await WorkspaceMembership.find({
            workspaceId: req.user.workspaceId,
            role: VIEWER_ROLE,
            status: { $ne: 'revoked' },
        }).sort({ createdAt: -1 }).lean();

        const users = await User.find({
            _id: { $in: memberships.map((membership) => membership.userId) },
        }).lean();
        const usersById = new Map(users.map((user) => [String(user._id), user]));

        return res.json(
            memberships
                .map((membership) => {
                    const user = usersById.get(String(membership.userId));
                    if (!user) {
                        return null;
                    }

                    return getPublicViewerMembership({ user, membership });
                })
                .filter(Boolean)
        );
    } catch (error) {
        logger.error('workspace.list_viewers_failed', {
            error: error instanceof Error ? error.message : String(error),
            workspaceId: req.user.workspaceId,
        });
        return res.status(500).json({ error: 'Failed to list viewers' });
    }
});

router.delete('/viewers/:email', requireAuth, requireAdmin, requireCsrf, async (req, res) => {
    const targetEmail = normalizeEmail(decodeURIComponent(req.params.email));

    try {
        const user = await User.findOne({ email: targetEmail }).lean();
        if (!user) {
            return res.status(404).json({ error: 'Viewer not found' });
        }

        const result = await WorkspaceMembership.deleteOne({
            workspaceId: req.user.workspaceId,
            userId: user._id,
            role: VIEWER_ROLE,
        });

        if (!result.deletedCount) {
            return res.status(404).json({ error: 'Viewer not found' });
        }

        await recordAuditEvent({
            workspaceId: req.user.workspaceId,
            userId: req.user.userId,
            action: 'workspace.member_removed',
            entityType: 'user',
            entityId: String(user._id),
            metadata: { email: targetEmail, role: VIEWER_ROLE },
        });

        return res.json({ message: 'Viewer removed' });
    } catch (error) {
        logger.error('workspace.remove_viewer_failed', {
            error: error instanceof Error ? error.message : String(error),
            email: targetEmail,
        });
        return res.status(500).json({ error: 'Failed to remove viewer' });
    }
});

module.exports = {
    router,
    requireAuth,
    requireAdmin,
    requireAccess,
    requireCsrf,
    initializeUserAccess,
    __internal: {
        DEFAULT_SELF_SERVICE_ACCESS,
        DEFAULT_VIEWER_ACCESS,
        SELF_SERVICE_REGISTRATION_SOURCE,
        VIEWER_ROLE,
        buildMembershipDefaults,
        buildUniqueWorkspaceSlug,
        generateSecretToken,
        getClientRoleForMembership,
        getCookieOptions,
        getPublicMembershipUser,
        getPublicViewerMembership,
        getRequiredJwtSecret,
        hashToken,
        isWorkspaceManager,
        normalizeAccess,
        normalizeEmail,
        normalizeFeatures,
        normalizeProjectIds,
        normalizeWorkspaceName,
        resolveProjectId,
        resolveFreshRole,
        resolveLoginRole,
        resolveLoginContext,
        upsertUserProfile,
        verifyGoogleCredential,
    },
};
