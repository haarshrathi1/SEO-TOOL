require('dotenv').config();
const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const auth = require('./auth');
const userAuth = require('./userAuth');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
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
            callback(null, true); // Allow all in dev, tighten in prod
        }
    },
    credentials: true
}));
app.use(express.json());
app.use(cookieParser());

// Serve static frontend in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));

// ─── Public Routes (no auth needed) ─────────────────────────────────────────

// User Auth (login, register)
app.use('/api/auth', userAuth.router);

// Google OAuth (for GSC/GA4 — only admin uses this)
app.use('/auth/google', auth.router);

// Health Check
app.get('/health', (req, res) => {
    const isAuthenticated = !!auth.getAuthClient();
    res.json({ status: 'ok', authenticated: isAuthenticated });
});

// ─── Protected Routes — All Users (admin + viewer) ─────────────────────────

const keywords = require('./keywords');
const keywordHistory = require('./keywordHistory');

app.post('/api/keywords/research', userAuth.requireAuth, keywords.researchKeyword);
app.post('/api/keywords/research-v2', userAuth.requireAuth, keywords.researchKeywordV2);
app.post('/api/keywords/analyze-content', userAuth.requireAuth, keywords.analyzePageContent);
app.get('/api/keywords/history', userAuth.requireAuth, (req, res) => {
    res.json(keywordHistory.getHistory());
});
app.post('/api/keywords/save', userAuth.requireAuth, (req, res) => {
    try {
        const result = keywordHistory.saveResearch(req.body);
        res.json(result);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ─── Protected Routes — Admin Only ─────────────────────────────────────────

const analyze = require('./analyze');
const { projects, getProject } = require('./projects');
const crawler = require('./crawler');
const indexing = require('./indexing');
const auditHistory = require('./auditHistory');
const { analyzePageContent } = require('./gemini');

app.get('/api/projects', userAuth.requireAuth, userAuth.requireAdmin, (req, res) => {
    res.json(projects);
});

app.get('/api/analyze', userAuth.requireAuth, userAuth.requireAdmin, async (req, res) => {
    if (!auth.getAuthClient()) {
        return res.status(401).json({ error: 'Google service not authenticated. Please visit /auth/google/login' });
    }
    await analyze.analyzeSite(req, res);
});

app.get('/api/history', userAuth.requireAuth, userAuth.requireAdmin, (req, res) => {
    const historyData = require('./history').getHistory();
    historyData.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(historyData);
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

app.get('/api/audit/history', userAuth.requireAuth, userAuth.requireAdmin, (req, res) => {
    const history = auditHistory.getAuditHistory();
    history.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json(history);
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
        auditHistory.addAudit(results, projectId);
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

// ─── SPA Fallback ───────────────────────────────────────────────────────────
app.get('*', (req, res) => {
    const indexPath = path.join(clientDist, 'index.html');
    if (require('fs').existsSync(indexPath)) {
        res.sendFile(indexPath);
    } else {
        res.status(404).json({ error: 'Not found' });
    }
});

const server = app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});

// Increase timeout to 20 minutes for long audits
server.setTimeout(1200000);
