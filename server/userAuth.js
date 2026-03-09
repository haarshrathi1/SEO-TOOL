const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
require('dotenv').config();

const router = express.Router();
const DATA_DIR = path.join(__dirname, 'data');
const VIEWERS_FILE = path.join(DATA_DIR, 'viewers.json');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const ADMIN_EMAIL = 'harshrathi.hyvikk@gmail.com';
const GOOGLE_CLIENT_ID = process.env.CLIENT_ID;
const TOKEN_EXPIRY = '7d';

// Google OAuth client for ID token verification
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// ─── Helpers ────────────────────────────────────────────────────────────────

function loadViewers() {
    try {
        if (fs.existsSync(VIEWERS_FILE)) {
            return JSON.parse(fs.readFileSync(VIEWERS_FILE, 'utf8'));
        }
    } catch (e) { console.error('Failed to load viewers:', e.message); }
    return [];
}

function saveViewers(viewers) {
    fs.writeFileSync(VIEWERS_FILE, JSON.stringify(viewers, null, 2));
}

function isAdminEmail(email) {
    return email.toLowerCase().trim() === ADMIN_EMAIL;
}

// ─── Middleware ──────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
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

// ─── Routes ─────────────────────────────────────────────────────────────────

// Google OAuth Login — verify Google ID token
router.post('/google-login', async (req, res) => {
    const { credential } = req.body;
    if (!credential) {
        return res.status(400).json({ error: 'Google credential required' });
    }

    try {
        // Verify the Google ID token
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });
        const payload = ticket.getPayload();
        const email = payload.email.toLowerCase().trim();
        const name = payload.name || email;
        const picture = payload.picture || '';

        // Check if admin
        if (isAdminEmail(email)) {
            const token = jwt.sign(
                { email, role: 'admin', name, picture },
                JWT_SECRET,
                { expiresIn: TOKEN_EXPIRY }
            );
            return res.json({
                token,
                user: { email, role: 'admin', name, picture }
            });
        }

        // Check if viewer
        const viewers = loadViewers();
        const viewer = viewers.find(v => v.email === email);
        if (viewer) {
            const token = jwt.sign(
                { email, role: 'viewer', name, picture, access: viewer.access || ['keywords'] },
                JWT_SECRET,
                { expiresIn: TOKEN_EXPIRY }
            );
            return res.json({
                token,
                user: { email, role: 'viewer', name, picture, access: viewer.access || ['keywords'] }
            });
        }

        // Not authorized
        return res.status(403).json({ error: 'Access denied. Your email is not authorized. Contact the admin.' });

    } catch (e) {
        console.error('Google login error:', e.message);
        return res.status(401).json({ error: 'Invalid Google credential' });
    }
});

// Get Google Client ID (for frontend)
router.get('/config', (req, res) => {
    res.json({ googleClientId: GOOGLE_CLIENT_ID });
});

// Validate token / get current user
router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

// Admin: Add viewer (just email, no password needed since Google OAuth)
router.post('/viewers', requireAuth, requireAdmin, (req, res) => {
    const { email, access } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (isAdminEmail(normalizedEmail)) {
        return res.status(400).json({ error: 'Admin email cannot be added as viewer' });
    }

    const viewers = loadViewers();
    if (viewers.find(v => v.email === normalizedEmail)) {
        return res.status(400).json({ error: 'Viewer already exists' });
    }

    const newViewer = {
        email: normalizedEmail,
        access: access || ['keywords'],
        createdAt: new Date().toISOString(),
    };
    viewers.push(newViewer);
    saveViewers(viewers);

    res.json({ message: 'Viewer added', viewer: { email: normalizedEmail, access: newViewer.access } });
});

// Admin: List viewers
router.get('/viewers', requireAuth, requireAdmin, (req, res) => {
    const viewers = loadViewers().map(v => ({
        email: v.email,
        access: v.access,
        createdAt: v.createdAt,
    }));
    res.json(viewers);
});

// Admin: Delete viewer
router.delete('/viewers/:email', requireAuth, requireAdmin, (req, res) => {
    const targetEmail = decodeURIComponent(req.params.email).toLowerCase().trim();
    let viewers = loadViewers();
    const before = viewers.length;
    viewers = viewers.filter(v => v.email !== targetEmail);
    if (viewers.length === before) {
        return res.status(404).json({ error: 'Viewer not found' });
    }
    saveViewers(viewers);
    res.json({ message: 'Viewer removed' });
});

module.exports = { router, requireAuth, requireAdmin };
