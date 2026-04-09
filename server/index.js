require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const fs = require('fs');
const path = require('path');
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
const { analyzePageContent } = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3001;

app.set('trust proxy', 1);

const ENABLE_CANONICAL_REDIRECT = process.env.ENABLE_CANONICAL_REDIRECT === 'true';
const CANONICAL_HOST = (() => {
    try {
        return process.env.CANONICAL_HOST || (process.env.FRONTEND_URL ? new URL(process.env.FRONTEND_URL).host : '');
    } catch {
        return '';
    }
})();

function getCanonicalBase(req) {
    const protoHeader = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0];
    const host = req.headers.host;
    const proto = protoHeader === 'https' ? 'https' : protoHeader === 'http' ? 'http' : 'http';
    return `${proto}://${host}`;
}

app.use((req, res, next) => {
    if (!ENABLE_CANONICAL_REDIRECT) return next();
    if (!req.headers.host || req.headers.host.startsWith('localhost') || req.headers.host.startsWith('127.')) return next();

    const proto = (req.headers['x-forwarded-proto'] || req.protocol || 'http').toString().split(',')[0];
    const expectedHost = CANONICAL_HOST || req.headers.host;
    const needsHost = CANONICAL_HOST && req.headers.host !== CANONICAL_HOST;
    const needsHttps = proto !== 'https';

    if (needsHost || needsHttps) {
        return res.redirect(301, `https://${expectedHost}${req.originalUrl}`);
    }

    return next();
});

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
    'https://seotool.harshrathi.com',
    'http://seotool.harshrathi.com',
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
        { loc: `${base}/keywords`, changefreq: 'weekly', priority: '0.5' },
        { loc: `${base}/projects`, changefreq: 'monthly', priority: '0.2' },
    ];

    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((url) => `  <url>\n    <loc>${url.loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>${url.changefreq}</changefreq>\n    <priority>${url.priority}</priority>\n  </url>`).join('\n')}\n</urlset>`;
    res.type('application/xml').send(xml);
});

app.use('/api/auth', userAuth.router);
app.use('/auth/google', auth.router);

app.get('/health', (req, res) => {
    res.json({ status: 'ok', authenticated: !!auth.getAuthClient() });
});

app.post('/api/keywords/research', userAuth.requireAuth, userAuth.requireAccess('keywords'), keywords.researchKeyword);
app.post('/api/keywords/research-v2', userAuth.requireAuth, userAuth.requireAccess('keywords'), keywords.researchKeywordV2);
app.post('/api/keywords/analyze-content', userAuth.requireAuth, userAuth.requireAccess('keywords'), keywords.analyzePageContent);
app.get('/api/keywords/ads-access', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        res.json(await keywordAdsAccess.getKeywordAdsUsageStatus(req.user));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/keywords/jobs', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        res.json(await keywordJobs.listKeywordJobs(req.user, { projectId: req.query.projectId }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/keywords/jobs', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        const seed = typeof req.body?.seed === 'string' ? req.body.seed.trim() : '';
        if (!seed) {
            return res.status(400).json({ error: 'Seed keyword required' });
        }

        const job = await keywordJobs.createKeywordJob(seed, req.user, {
            projectId: req.body?.projectId,
        });
        return res.status(202).json(job);
    } catch (e) {
        return res.status(400).json({ error: e.message });
    }
});

app.get('/api/keywords/jobs/:jobId', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        const job = await keywordJobs.getKeywordJob(req.params.jobId, req.user, { projectId: req.query.projectId });
        if (!job) {
            return res.status(404).json({ error: 'Keyword job not found' });
        }

        return res.json(job);
    } catch (e) {
        return res.status(500).json({ error: e.message });
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
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.get('/api/keywords/history', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        res.json(await keywordHistory.getHistory(req.user, {
            projectId: req.query.projectId,
            limit: req.query.limit,
            before: req.query.before,
        }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/keywords/save', userAuth.requireAuth, userAuth.requireAccess('keywords'), async (req, res) => {
    try {
        const result = await keywordHistory.saveResearch(req.user, req.body, { projectId: req.body.projectId });
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/projects', userAuth.requireAuth, async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        res.json(await projects.listProjects(req.user, { includeInactive }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/projects', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const project = await projects.createProject(req.body);
        res.status(201).json(project);
    } catch (e) {
        res.status(400).json({ error: e.message });
    }
});

app.put('/api/projects/:projectId', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const project = await projects.updateProject(req.params.projectId, req.body);
        res.json(project);
    } catch (e) {
        const status = e.message === 'Project not found' ? 404 : 400;
        res.status(status).json({ error: e.message });
    }
});

app.delete('/api/projects/:projectId', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const project = await projects.archiveProject(req.params.projectId);
        res.json(project);
    } catch (e) {
        const status = e.message === 'Project not found' ? 404 : 400;
        res.status(status).json({ error: e.message });
    }
});

app.get('/api/analyze', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    if (!auth.getAuthClient()) {
        return res.status(401).json({ error: 'Google service not authenticated. Please visit /auth/google/login' });
    }
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/indexing/publish', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const result = await indexing.publish(url);
        if (result?.error) {
            return res.status(502).json({ error: result.error });
        }

        return res.json(result);
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/indexing/remove', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const result = await indexing.remove(url);
        if (result?.error) {
            return res.status(502).json({ error: result.error });
        }

        return res.json(result);
    } catch (e) {
        return res.status(500).json({ error: e.message });
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
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/audit/jobs', userAuth.requireAuth, userAuth.requireAccess('audit'), async (req, res) => {
    try {
        res.json(await auditJobs.listAuditJobs(req.user, { projectId: req.query.projectId }));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/audit/jobs', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        if (!auth.getAuthClient()) {
            return res.status(401).json({ error: 'Google service not authenticated.' });
        }

        if (!req.body.projectId) {
            return res.status(400).json({ error: 'Project ID is required' });
        }

        const job = await auditJobs.createAuditJob(req.body.projectId, req.user);
        return res.status(202).json(job);
    } catch (e) {
        const status = e.message === 'Project not found' ? 404 : 400;
        return res.status(status).json({ error: e.message });
    }
});

app.get('/api/audit/jobs/:jobId', userAuth.requireAuth, userAuth.requireAccess('audit'), async (req, res) => {
    try {
        const job = await auditJobs.getAuditJob(req.params.jobId, req.user);
        if (!job) {
            return res.status(404).json({ error: 'Audit job not found' });
        }

        return res.json(job);
    } catch (e) {
        return res.status(500).json({ error: e.message });
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
    } catch (e) {
        return res.status(500).json({ error: e.message });
    }
});

app.post('/api/audit', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        if (!auth.getAuthClient()) {
            return res.status(401).json({ error: 'Google service not authenticated.' });
        }

        if (!req.body.projectId) {
            return res.status(400).json({ error: 'Project ID is required' });
        }

        const job = await auditJobs.createAuditJob(req.body.projectId, req.user);
        return res.status(202).json(job);
    } catch (e) {
        const status = e.message === 'Project not found' ? 404 : 400;
        return res.status(status).json({ error: e.message });
    }
});

app.post('/api/ai/analyze', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const { url, content } = req.body;
        if (!url) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const analysis = await analyzePageContent(url, content);
        return res.json(analysis);
    } catch (error) {
        console.error('AI Analysis Failed:', error);
        if (error instanceof Error && /localhost|private|valid public http\(s\)|hostname could not be resolved/i.test(error.message)) {
            return res.status(400).json({ error: error.message });
        }
        return res.status(500).json({ error: error.message });
    }
});

app.get('*', (req, res) => {
    const indexPath = path.join(clientDist, 'index.html');
    if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

const STARTUP_RETRY_DELAY_MS = Math.max(Number(process.env.STARTUP_RETRY_DELAY_MS || 5000), 1000);

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function initializeAppDependencies() {
    await connectMongo();
    await projects.initializeProjects();
    await userAuth.initializeUserAccess();
    await keywordJobs.initializeKeywordJobs();
    await auditJobs.initializeAuditJobs();
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
                console.log(`Server running on http://localhost:${PORT}`);
            });

            server.setTimeout(1200000);
            return server;
        } catch (error) {
            if (!isRetriableStartupError(error)) {
                console.error('Failed to start server:', error);
                process.exit(1);
            }

            const reason = error?.cause?.code || error?.code || error?.name || 'startup error';
            console.error(`[Startup] MongoDB connection failed on attempt ${attempt} (${reason}). Retrying in ${STARTUP_RETRY_DELAY_MS}ms...`);
            if (error?.message) {
                console.error(`[Startup] ${error.message}`);
            }
            await sleep(STARTUP_RETRY_DELAY_MS);
        }
    }
}

startServer();


