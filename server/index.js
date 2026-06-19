const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { config, assertCoreConfig } = require('./config');
const { logger } = require('./logger');
const auth = require('./auth');
const userAuth = require('./userAuth');
const { connectMongo, __internal: dbInternal } = require('./db');
const keywords = require('./keywords');
const keywordHistory = require('./keywordHistory');
const keywordJobs = require('./keywordJobs');
const keywordAdsAccess = require('./keywordAdsAccess');
const analyze = require('./analyze');
const history = require('./history');
const projects = require('./projects');
const indexing = require('./indexing');
const auditHistory = require('./auditHistory');
const auditJobs = require('./auditJobs');
const speedCheck = require('./speedCheck');
const demo = require('./demo');
const { chatRouter } = require('./chat');
const { User, WorkspaceMembership } = require('./models');

const app = express();
const PORT = config.port;

function safeErrMsg(error) {
    return (error != null && typeof error.message === 'string') ? error.message : String(error ?? 'Unknown error');
}

function buildRateLimiter(options) {
    return rateLimit({
        windowMs: options.windowMs,
        limit: options.max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'Too many requests. Please slow down and try again shortly.' },
    });
}

function createJobHandler(createJobFn) {
    return async (req, res) => {
        try {
            const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
            if (!projectId) {
                return res.status(400).json({ error: 'Project ID is required' });
            }

            const project = await projects.getProject(projectId, req.user);
            if (!project) {
                return res.status(404).json({ error: 'Project not found' });
            }

            if (!await auth.hasProjectAuth(project)) {
                return res.status(401).json({ error: 'Google service not authenticated for this project. Connect Google from the project setup page first.' });
            }

            const job = await createJobFn(projectId, req.user);
            return res.status(202).json(job);
        } catch (error) {
            const status = error.message === 'Project not found' ? 404 : error.message === 'Project access denied' ? 403 : 400;
            return res.status(status).json({ error: safeErrMsg(error) });
        }
    };
}

app.set('trust proxy', 1);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                'https://accounts.google.com',
                "'unsafe-inline'",
            ],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
            fontSrc: ["'self'", 'https://fonts.gstatic.com'],
            imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
            connectSrc: [
                "'self'",
                'https://accounts.google.com',
                config.frontendUrl,
            ].filter(Boolean),
            frameSrc: ['https://accounts.google.com'],
            frameAncestors: ["'none'"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            upgradeInsecureRequests: [],
        },
    },
    hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
    },
    noSniff: true,
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-origin' },
}));

function getCanonicalBase(req) {
    const protoHeader = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0];
    const host = req.headers.host;
    const proto = protoHeader === 'https' ? 'https' : 'http';
    return `${proto}://${host}`;
}

app.use((req, res, next) => {
    if (!config.security.enableCanonicalRedirect) return next();
    if (!req.headers.host || req.headers.host.startsWith('localhost') || req.headers.host.startsWith('127.')) return next();

    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0];
    const expectedHost = config.security.canonicalHost || req.headers.host;
    const needsHost = config.security.canonicalHost && req.headers.host !== config.security.canonicalHost;
    const needsHttps = proto !== 'https';

    if (needsHost || needsHttps) {
        return res.redirect(301, `https://${expectedHost}${req.originalUrl}`);
    }

    return next();
});

const allowedOrigins = [
    config.frontendUrl,
    'http://localhost:5173',
    'http://localhost:3000',
].filter(Boolean).map((origin) => origin.replace(/\/+$/, ''));

app.use(cors({
    origin: (origin, callback) => {
        const normalizedOrigin = origin ? origin.replace(/\/+$/, '') : origin;
        if (!normalizedOrigin || allowedOrigins.includes(normalizedOrigin)) {
            callback(null, true);
            return;
        }

        callback(new Error('Origin not allowed by CORS'));
    },
    credentials: true,
}));
app.use(express.json({ limit: '2mb' }));
app.use(cookieParser());

const authLimiter = buildRateLimiter(config.rateLimit.auth);
const aiLimiter = buildRateLimiter(config.rateLimit.ai);
const jobLimiter = buildRateLimiter(config.rateLimit.jobs);

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

app.get('/robots.txt', (req, res) => {
    const base = getCanonicalBase(req);
    res.type('text/plain').send([
        'User-agent: *',
        'Allow: /',
        'Disallow: /api/',
        'Disallow: /auth/',
        `Sitemap: ${base}/sitemap.xml`,
    ].join('\n'));
});

app.get('/sitemap.xml', (req, res) => {
    const base = getCanonicalBase(req);
    const today = new Date().toISOString().split('T')[0];
    const urls = [
        { loc: `${base}/`, changefreq: 'weekly', priority: '0.8' },
        { loc: `${base}/demo`, changefreq: 'weekly', priority: '0.7' },
        { loc: `${base}/privacy`, changefreq: 'monthly', priority: '0.3' },
        { loc: `${base}/terms`, changefreq: 'monthly', priority: '0.3' },
        { loc: `${base}/keywords`, changefreq: 'weekly', priority: '0.5' },
        { loc: `${base}/projects`, changefreq: 'monthly', priority: '0.2' },
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url>\n    <loc>${url.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${url.changefreq}</changefreq>\n    <priority>${url.priority}</priority>\n  </url>`).join('\n')}\n</urlset>`;
    res.type('application/xml').send(xml);
});

app.use('/api/auth', authLimiter, userAuth.router);
app.use('/auth/google', auth.router);
app.use('/api/google', userAuth.requireAuth, auth.userRouter);

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        authenticated: !!auth.getAuthClient(),
        queueMode: config.queue.mode,
        processRole: config.processRole,
    });
});

app.get('/api/demo/summary', (req, res) => {
    res.json(demo.getDemoSummary());
});

app.post('/api/keywords/analyze-content', userAuth.requireAuth, userAuth.requireCsrf, aiLimiter, userAuth.requireAccess('keywords'), keywords.analyzePageContent);
app.get('/api/keywords/ads-access', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
        res.json(await keywordAdsAccess.getKeywordAdsUsageStatus(req.user));
    } catch (error) {
        res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.get('/api/keywords/jobs', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        res.json(await keywordJobs.listKeywordJobs(req.user, { projectId: req.query.projectId }));
    } catch (error) {
        res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.post('/api/keywords/jobs', userAuth.requireAuth, userAuth.requireCsrf, jobLimiter, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        const seed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
        if (!seed) {
            return res.status(400).json({ error: 'Seed keyword required' });
        }

        const job = await keywordJobs.createKeywordJob(seed, req.user, {
            projectId: req.body?.projectId,
        });
        return res.status(202).json(job);
    } catch (error) {
        return res.status(400).json({ error: safeErrMsg(error) });
    }
});

app.get('/api/keywords/jobs/:jobId', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        const job = await keywordJobs.getKeywordJob(req.params.jobId, req.user, { projectId: req.query.projectId });
        if (!job) {
            return res.status(404).json({ error: 'Keyword job not found' });
        }

        return res.json(job);
    } catch (error) {
        return res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.get('/api/keywords/jobs/:jobId/result', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        const job = await keywordJobs.getKeywordJob(req.params.jobId, req.user, {
            projectId: req.query.projectId,
            includeResult: true,
        });
        if (!job) {
            return res.status(404).json({ error: 'Keyword job not found' });
        }

        if (job.status !== 'completed') {
            return res.status(409).json({ error: 'Keyword job is not complete yet' });
        }

        return res.json(job);
    } catch (error) {
        return res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.get('/api/keywords/history', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        res.json(await keywordHistory.getHistory(req.user, {
            projectId: req.query.projectId,
            limit: req.query.limit,
            before: req.query.before,
        }));
    } catch (error) {
        res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.post('/api/keywords/save', userAuth.requireAuth, userAuth.requireCsrf, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        const result = await keywordHistory.saveResearch(req.user, req.body, { projectId: req.body.projectId });
        res.json(result);
    } catch (error) {
        res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.get('/api/workspaces/current', userAuth.requireAuth, (req, res) => {
    res.json({
        workspace: {
            id: req.user.workspaceId,
            slug: req.user.workspaceSlug,
            name: req.user.workspaceName,
            role: req.user.workspaceRole,
        },
    });
});

app.get('/api/workspaces/current/members', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    const memberships = await WorkspaceMembership.find({
        workspaceId: req.user.workspaceId,
        status: { $ne: 'revoked' },
    }).lean();
    const users = await User.find({
        _id: { $in: memberships.map((membership) => membership.userId) },
    }).lean();
    const usersById = new Map(users.map((user) => [String(user._id), user]));

    res.json({
        items: memberships
            .map((membership) => {
                const user = usersById.get(String(membership.userId));
                if (!user) {
                    return null;
                }

                return {
                    email: user.email,
                    name: user.displayName || user.email,
                    picture: user.picture || '',
                    role: membership.role,
                    access: Array.isArray(membership.access) ? membership.access : [],
                    features: Array.isArray(membership.features) ? membership.features : [],
                    projectIds: Array.isArray(membership.projectIds) ? membership.projectIds : [],
                    status: membership.status || 'active',
                    createdAt: membership.createdAt || null,
                    updatedAt: membership.updatedAt || null,
                };
            })
            .filter(Boolean),
    });
});

app.get('/api/projects', userAuth.requireAuth, async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        res.json(await projects.listProjects(req.user, { includeInactive }));
    } catch (error) {
        res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.post('/api/projects', userAuth.requireAuth, userAuth.requireCsrf, userAuth.requireAccess('dashboard'), async (req, res) => {
    try {
        const project = await projects.createProject(req.body, req.user);
        res.status(201).json(project);
    } catch (error) {
        const status = error.message === 'Project access denied' ? 403 : 400;
        res.status(status).json({ error: safeErrMsg(error) });
    }
});

app.put('/api/projects/:projectId', userAuth.requireAuth, userAuth.requireCsrf, userAuth.requireAccess('dashboard'), async (req, res) => {
    try {
        const project = await projects.updateProject(req.params.projectId, req.body, req.user);
        res.json(project);
    } catch (error) {
        const status = error.message === 'Project not found' ? 404 : error.message === 'Project access denied' ? 403 : 400;
        res.status(status).json({ error: safeErrMsg(error) });
    }
});

app.delete('/api/projects/:projectId', userAuth.requireAuth, userAuth.requireCsrf, userAuth.requireAccess('dashboard'), async (req, res) => {
    try {
        const mode = req.query.mode === 'archive' ? 'archive' : 'delete';
        const project = mode === 'archive'
            ? await projects.archiveProject(req.params.projectId, req.user)
            : await projects.deleteProject(req.params.projectId, req.user);
        res.json(project);
    } catch (error) {
        const status = error.message === 'Project not found' ? 404 : error.message === 'Project access denied' ? 403 : 400;
        res.status(status).json({ error: safeErrMsg(error) });
    }
});

app.get('/api/analyze', userAuth.requireAuth, userAuth.requireAccess('dashboard'), async (req, res) => {
    return analyze.analyzeSite(req, res);
});

app.get('/api/history', userAuth.requireAuth, userAuth.requireAccess('dashboard'), async (req, res) => {
    try {
        const historyData = await history.getHistory(req.user, {
            projectId: req.query.projectId,
            limit: req.query.limit,
            before: req.query.before,
        });
        res.json(historyData);
    } catch (error) {
        res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.post('/api/indexing/publish', userAuth.requireAuth, userAuth.requireCsrf, userAuth.requireAdmin, async (req, res) => {
    try {
        const { url, projectId } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const project = projectId ? await projects.getProject(projectId, req.user) : null;
        const result = await indexing.publish(url, project);
        if (result?.error) {
            return res.status(502).json({ error: result.error });
        }

        return res.json(result);
    } catch (error) {
        return res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.post('/api/indexing/remove', userAuth.requireAuth, userAuth.requireCsrf, userAuth.requireAdmin, async (req, res) => {
    try {
        const { url, projectId } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const project = projectId ? await projects.getProject(projectId, req.user) : null;
        const result = await indexing.remove(url, project);
        if (result?.error) {
            return res.status(502).json({ error: result.error });
        }

        return res.json(result);
    } catch (error) {
        return res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.get('/api/audit/history', userAuth.requireAuth, userAuth.requireAccess('audit'), async (req, res) => {
    try {
        const auditData = await auditHistory.getAuditHistory(req.user, {
            projectId: req.query.projectId,
            limit: req.query.limit,
            before: req.query.before,
        });
        res.json(auditData);
    } catch (error) {
        res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.get('/api/audit/jobs', userAuth.requireAuth, userAuth.requireAccess('audit'), async (req, res) => {
    try {
        res.json(await auditJobs.listAuditJobs(req.user, { projectId: req.query.projectId }));
    } catch (error) {
        res.status(500).json({ error: safeErrMsg(error) });
    }
});

const auditRunHandler = createJobHandler(auditJobs.createAuditJob);
app.post('/api/audit/jobs', userAuth.requireAuth, userAuth.requireCsrf, jobLimiter, userAuth.requireAccess('audit'), auditRunHandler);

app.get('/api/audit/jobs/:jobId', userAuth.requireAuth, userAuth.requireAccess('audit'), async (req, res) => {
    try {
        const job = await auditJobs.getAuditJob(req.params.jobId, req.user);
        if (!job) {
            return res.status(404).json({ error: 'Audit job not found' });
        }

        return res.json(job);
    } catch (error) {
        return res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.get('/api/audit/jobs/:jobId/result', userAuth.requireAuth, userAuth.requireAccess('audit'), async (req, res) => {
    try {
        const job = await auditJobs.getAuditJob(req.params.jobId, req.user, { includeResult: true });
        if (!job) {
            return res.status(404).json({ error: 'Audit job not found' });
        }

        if (job.status !== 'completed') {
            return res.status(409).json({ error: 'Audit job is not complete yet' });
        }

        return res.json(job);
    } catch (error) {
        return res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.post('/api/audit/gsc-deep', userAuth.requireAuth, userAuth.requireCsrf, jobLimiter, userAuth.requireAccess('audit'), createJobHandler(auditJobs.createGscDeepAuditJob));

app.post('/api/audit/speed', userAuth.requireAuth, userAuth.requireCsrf, jobLimiter, userAuth.requireAccess('audit'), async (req, res) => {
    try {
        const projectId = typeof req.body?.projectId === 'string' ? req.body.projectId.trim() : '';
        const url = typeof req.body?.url === 'string' ? req.body.url.trim() : '';
        if (!projectId) {
            return res.status(400).json({ error: 'Project ID is required' });
        }
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const result = await speedCheck.checkSpeed(projectId, url, req.user);
        return res.json(result);
    } catch (error) {
        return res.status(error?.statusCode || 500).json({ error: safeErrMsg(error) });
    }
});

app.delete('/api/audit/jobs/:jobId', userAuth.requireAuth, userAuth.requireCsrf, userAuth.requireAccess('audit'), async (req, res) => {
    try {
        const job = await auditJobs.cancelAuditJob(req.params.jobId, req.user);
        if (!job) {
            return res.status(404).json({ error: 'Audit job not found' });
        }
        return res.json(job);
    } catch (error) {
        return res.status(500).json({ error: safeErrMsg(error) });
    }
});

app.use('/api/chat', userAuth.requireAuth, userAuth.requireCsrf, aiLimiter, chatRouter);

app.get('*', (req, res) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
        return res.status(404).json({ error: 'Not found' });
    }

    const indexPath = path.join(clientDist, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    logger.error('express.unhandled_error', {
        error: err instanceof Error ? err.message : safeErrMsg(err),
    });
    if (res.headersSent) return;
    res.status(500).json({
        error: config.isProduction ? 'Internal server error' : safeErrMsg(err),
    });
});

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function initializeAppDependencies() {
    assertCoreConfig();
    await connectMongo();
    await projects.initializeProjects();
    await userAuth.initializeUserAccess();
    const shouldStartWorkersInProcess = config.processRole === 'worker' || config.queue.mode === 'inline';
    await keywordJobs.initializeKeywordJobs({ startWorkers: shouldStartWorkersInProcess });
    await auditJobs.initializeAuditJobs({ startWorkers: shouldStartWorkersInProcess });
    await auth.initializeAuth();
}

function isRetriableStartupError(error) {
    return dbInternal.isRetriableMongoError(error);
}

async function startServer() {
    let attempt = 0;

    while (true) {
        attempt += 1;

        try {
            await initializeAppDependencies();

            const server = app.listen(PORT, () => {
                logger.info('server.started', { port: PORT });
            });

            server.setTimeout(1200000);
            return server;
        } catch (error) {
            if (!isRetriableStartupError(error)) {
                logger.error('server.start_failed', {
                    error: safeErrMsg(error),
                });
                process.exit(1);
            }

            const reason = error?.cause?.code || error?.code || error?.name || 'startup error';
            logger.warn('server.start_retrying', {
                attempt,
                reason,
                delayMs: config.startup.retryDelayMs,
                message: error?.message || '',
            });
            await sleep(config.startup.retryDelayMs);
        }
    }
}

process.on('uncaughtException', (error) => {
    logger.error('process.uncaught_exception', {
        error: safeErrMsg(error),
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandled_rejection', {
        error: safeErrMsg(reason),
    });
    process.exit(1);
});

startServer();
