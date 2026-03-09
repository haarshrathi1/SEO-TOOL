const jwt = require('jsonwebtoken');
const express = require('express');
const { OAuth2Client } = require('google-auth-library');
const { Viewer } = require('./models');
require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_change_me';
const GOOGLE_CLIENT_ID = process.env.CLIENT_ID;
const TOKEN_EXPIRY = '7d';
const LEGACY_ADMIN_EMAIL = 'harshrathi.hyvikk@gmail.com';
const DEV_ADMIN_BYPASS = /^(1|true|yes|on)$/i.test(process.env.DEV_ADMIN_BYPASS || '');

const adminEmails = new Set(
    [
        process.env.ADMIN_EMAIL || LEGACY_ADMIN_EMAIL,
        ...(process.env.ADMIN_EMAILS || '').split(','),
    ]
        .map((email) => email.toLowerCase().trim())
        .filter(Boolean)
);

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

function isAdminEmail(email) {
    return adminEmails.has(email.toLowerCase().trim());
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

function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader && authHeader.startsWith('Bearer ')
        ? authHeader.split(' ')[1]
        : null;

    const cookieToken = req.cookies?.seo_token || null;
    const headerToken = req.headers['x-access-token'] || null;
    const token = bearerToken || cookieToken || headerToken;

    if (!token) {
        return res.status(401).json({ error: 'Authentication required' });
    }

    try {
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

router.post('/google-login', async (req, res) => {
    const { credential } = req.body;
    if (!credential) {
        return res.status(400).json({ error: 'Google credential required' });
    }

    try {
        const ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: GOOGLE_CLIENT_ID,
        });

        const payload = ticket.getPayload();
        const email = payload.email.toLowerCase().trim();
        const name = payload.name || email;
        const picture = payload.picture || '';

        if (isAdminEmail(email) || shouldBypassAdmin(req)) {
            const token = jwt.sign(
                { email, role: 'admin', name, picture },
                JWT_SECRET,
                { expiresIn: TOKEN_EXPIRY }
            );

            res.cookie('seo_token', token, getCookieOptions());
            return res.json({ token, user: { email, role: 'admin', name, picture } });
        }

        const viewer = await Viewer.findOne({ email }).lean();
        if (viewer) {
            const token = jwt.sign(
                { email, role: 'viewer', name, picture, access: viewer.access || ['keywords'] },
                JWT_SECRET,
                { expiresIn: TOKEN_EXPIRY }
            );

            res.cookie('seo_token', token, getCookieOptions());
            return res.json({
                token,
                user: { email, role: 'viewer', name, picture, access: viewer.access || ['keywords'] },
            });
        }

        return res.status(403).json({ error: 'Access denied. Your email is not authorized. Contact the admin.' });
    } catch (e) {
        console.error('Google login error:', e.message);
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
    const { email, access } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Email required' });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (isAdminEmail(normalizedEmail)) {
        return res.status(400).json({ error: 'Admin email cannot be added as viewer' });
    }

    try {
        const existing = await Viewer.findOne({ email: normalizedEmail }).lean();
        if (existing) {
            return res.status(400).json({ error: 'Viewer already exists' });
        }

        const newViewer = await Viewer.create({
            email: normalizedEmail,
            access: Array.isArray(access) && access.length ? access : ['keywords'],
            createdAt: new Date(),
        });

        res.json({ message: 'Viewer added', viewer: { email: normalizedEmail, access: newViewer.access } });
    } catch (e) {
        console.error('Failed to add viewer:', e.message);
        res.status(500).json({ error: 'Failed to add viewer' });
    }
});

router.get('/viewers', requireAuth, requireAdmin, async (req, res) => {
    try {
        const viewers = await Viewer.find({}).sort({ createdAt: -1 }).lean();
        res.json(viewers.map((v) => ({
            email: v.email,
            access: v.access,
            createdAt: v.createdAt,
        })));
    } catch (e) {
        console.error('Failed to list viewers:', e.message);
        res.status(500).json({ error: 'Failed to list viewers' });
    }
});

router.delete('/viewers/:email', requireAuth, requireAdmin, async (req, res) => {
    const targetEmail = decodeURIComponent(req.params.email).toLowerCase().trim();

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

module.exports = { router, requireAuth, requireAdmin };
