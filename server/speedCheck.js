const psi = require('./psi');
const auth = require('./auth');
const { getProject } = require('./projects');
const { PsiCache } = require('./models');

const PSI_CACHE_TTL_MS = Math.max(60 * 60 * 1000, Number(process.env.PSI_CACHE_TTL_MS || 24 * 60 * 60 * 1000));

function normalizeUrl(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return '';
    }
    try {
        const parsed = new URL(value);
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return value.trim();
    }
}

// Separate namespace from any legacy raw-PSI cache entries — payload shape differs.
function buildCacheKey(url) {
    return `speed:${normalizeUrl(url)}`;
}

async function getCachedSpeed(url) {
    const cached = await PsiCache.findOne({
        cacheKey: buildCacheKey(url),
        expiresAt: { $gt: new Date() },
    }).lean();
    return cached?.payload || null;
}

async function setCachedSpeed(url, payload) {
    await PsiCache.findOneAndUpdate(
        { cacheKey: buildCacheKey(url) },
        {
            cacheKey: buildCacheKey(url),
            url,
            payload,
            expiresAt: new Date(Date.now() + PSI_CACHE_TTL_MS),
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );
}

// On-demand PageSpeed Insights check for a single audited URL.
async function checkSpeed(projectId, url, user) {
    const targetUrl = normalizeUrl(url);
    if (!targetUrl) {
        throw new Error('A valid URL is required');
    }

    const project = await getProject(projectId, user);
    if (!project) {
        const error = new Error('Project not found');
        error.statusCode = 404;
        throw error;
    }

    const cached = await getCachedSpeed(targetUrl);
    if (cached) {
        return { url: targetUrl, ...cached };
    }

    const authClient = await auth.getProjectAuthClient(project);
    const rawPsi = await psi.getPSI(targetUrl, { authClient });
    const summary = psi.formatPsiSummary(rawPsi);

    await setCachedSpeed(targetUrl, summary);
    return { url: targetUrl, ...summary };
}

module.exports = {
    checkSpeed,
    __internal: { buildCacheKey, normalizeUrl },
};
