require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const auth = require('./auth');
const userAuth = require('./userAuth');
const { connectMongo } = require('./db');

const keywords = require('./keywords');
const keywordHistory = require('./keywordHistory');
const analyze = require('./analyze');
const history = require('./history');
const { projects, getProject } = require('./projects');
const crawler = require('./crawler');
const indexing = require('./indexing');
const auditHistory = require('./auditHistory');
const { analyzePageContent } = require('./gemini');

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = [
    'http://localhost:5173',
    'http://localhost:3000',
    process.env.FRONTEND_URL,
    'https://seotool.harshrathi.com',
    'http://seotool.harshrathi.com',
].filter(Boolean);

app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            callback(null, true);
        }
    },
    credentials: true,
}));
app.use(express.json());
app.use(cookieParser());

const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// Public routes
app.use('/api/auth', userAuth.router);
app.use('/auth/google', auth.router);

app.get('/health', (req, res) => {
    const isAuthenticated = !!auth.getAuthClient();
    res.json({ status: 'ok', authenticated: isAuthenticated });
});

// Protected routes - all users
app.post('/api/keywords/research', userAuth.requireAuth, keywords.researchKeyword);
app.post('/api/keywords/research-v2', userAuth.requireAuth, keywords.researchKeywordV2);
app.post('/api/keywords/analyze-content', userAuth.requireAuth, keywords.analyzePageContent);

app.get('/api/keywords/history', userAuth.requireAuth, async (req, res) => {
    try {
        res.json(await keywordHistory.getHistory());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/keywords/save', userAuth.requireAuth, async (req, res) => {
    try {
        const result = await keywordHistory.saveResearch(req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Protected routes - admin only
app.get('/api/projects', userAuth.requireAuth, userAuth.requireAdmin, (req, res) => {
    res.json(projects);
});

app.get('/api/analyze', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    if (!auth.getAuthClient()) {
        return res.status(401).json({ error: 'Google service not authenticated. Please visit /auth/google/login' });
    }
    await analyze.analyzeSite(req, res);
});

app.get('/api/history', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const historyData = await history.getHistory();
        historyData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json(historyData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/indexing/publish', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const { url } = req.body;
        const result = await indexing.publish(url);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/indexing/remove', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const { url } = req.body;
        const result = await indexing.remove(url);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/audit/history', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const auditData = await auditHistory.getAuditHistory();
        auditData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
        res.json(auditData);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/audit', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const { projectId } = req.body;
        if (!auth.getAuthClient()) {
            return res.status(401).json({ error: 'Google service not authenticated.' });
        }

        const project = getProject(projectId);
        const url = project.url;
        console.log(`Starting audit for project: ${project.name} (${url})`);

        const results = await crawler.crawlSite(url);
        await auditHistory.addAudit(results, projectId);
        res.json(results);
    } catch (e) {
        console.error('Audit failed:', e);
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/ai/analyze', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    try {
        const { url, content } = req.body;
        if (!url) return res.status(400).json({ error: 'URL is required' });
        const analysis = await analyzePageContent(url, content);
        res.json(analysis);
    } catch (error) {
        console.error('AI Analysis Failed:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('*', (req, res) => {
    const indexPath = path.join(clientDist, 'index.html');
    if (require('fs').existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

async function startServer() {
    try {
        await connectMongo();
        await auth.initializeAuth();

        const server = app.listen(PORT, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });

        server.setTimeout(1200000);
    } catch (error) {
        console.error('Failed to start server:', error);
        process.exit(1);
    }
}

startServer();


