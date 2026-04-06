const { AdminUser, KeywordJob, Viewer } = require('./models');
const { runKeywordResearchV2, TOTAL_LAYERS, getRuntimeProviderLabel } = require('./keywordResearchService');

const KEYWORD_WORKER_ID = `keyword-worker:${process.pid}`;
const DEFAULT_LEASE_MS = 3 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 30 * 1000;
const DEFAULT_POLL_MS = 1500;
const DEFAULT_CONCURRENCY = 1;
const ACTIVE_KEYWORD_STATUSES = ['queued', 'running'];

let keywordWorkerTimer = null;
const runningKeywordJobs = new Set();

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

function getLeaseMs() {
    return parsePositiveInt(process.env.KEYWORD_JOB_LEASE_MS, DEFAULT_LEASE_MS);
}

function getHeartbeatMs() {
    return parsePositiveInt(process.env.KEYWORD_JOB_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS);
}

function getPollMs() {
    return parsePositiveInt(process.env.KEYWORD_JOB_POLL_MS, DEFAULT_POLL_MS);
}

function getConcurrency() {
    return parsePositiveInt(process.env.KEYWORD_JOB_WORKER_CONCURRENCY, DEFAULT_CONCURRENCY);
}

function getLeaseExpiry(date = new Date()) {
    return new Date(date.getTime() + getLeaseMs());
}

function normalizeProjectId(projectId) {
    return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
}

function normalizeSeed(seed) {
    return typeof seed === 'string' && seed.trim() ? seed.trim() : '';
}

function buildKeywordJobQuery(user, options = {}) {
    const query = { ownerEmail: user.email };
    const projectId = normalizeProjectId(options.projectId);
    if (projectId) {
        query.projectId = projectId;
    }
    return query;
}

function canAccessKeywordJob(job, user) {
    return Boolean(job && user?.email && job.ownerEmail === user.email);
}

async function loadJobUser(job) {
    const email = String(job?.ownerEmail || '').toLowerCase().trim();
    if (!email) {
        return null;
    }

    const admin = await AdminUser.findOne({ email }).lean();
    if (admin) {
        return {
            email,
            role: 'admin',
            access: ['keywords', 'dashboard', 'audit'],
            features: ['keyword_ads'],
            projectIds: [],
        };
    }

    const viewer = await Viewer.findOne({ email }).lean();
    if (viewer) {
        return {
            email,
            role: 'viewer',
            access: Array.isArray(viewer.access) ? viewer.access : ['keywords'],
            features: Array.isArray(viewer.features) ? viewer.features : [],
            projectIds: Array.isArray(viewer.projectIds) ? viewer.projectIds : [],
        };
    }

    return {
        email,
        role: 'viewer',
        access: ['keywords'],
        features: [],
        projectIds: [],
    };
}

function serializeJob(record, options = {}) {
    const job = typeof record.toObject === 'function' ? record.toObject() : record;
    return {
        id: job._id?.toString?.() || job.id,
        seed: job.seed,
        projectId: job.projectId || null,
        options: job.options || { useAdsData: false },
        ownerEmail: job.ownerEmail,
        status: job.status,
        progress: job.progress,
        error: job.error || '',
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: options.includeResult ? (job.result || null) : undefined,
    };
}

async function touchKeywordJobLease(jobId) {
    const now = new Date();
    await KeywordJob.findOneAndUpdate(
        {
            _id: jobId,
            leaseOwner: KEYWORD_WORKER_ID,
            status: 'running',
        },
        {
            leaseExpiresAt: getLeaseExpiry(now),
            lastHeartbeatAt: now,
        }
    );
}

async function claimNextKeywordJob() {
    const now = new Date();
    const claimed = await KeywordJob.findOneAndUpdate(
        {
            status: { $in: ACTIVE_KEYWORD_STATUSES },
            $or: [
                { leaseExpiresAt: { $exists: false } },
                { leaseExpiresAt: null },
                { leaseExpiresAt: { $lte: now } },
            ],
        },
        {
            $set: {
                status: 'running',
                leaseOwner: KEYWORD_WORKER_ID,
                leaseStartedAt: now,
                leaseExpiresAt: getLeaseExpiry(now),
                lastHeartbeatAt: now,
                error: '',
                completedAt: null,
            },
            $inc: { attemptCount: 1 },
        },
        {
            new: true,
            sort: { createdAt: 1 },
        }
    ).lean();

    return claimed;
}

async function runKeywordJob(jobRecord) {
    const jobId = jobRecord._id?.toString?.() || String(jobRecord._id || jobRecord.id || '');
    if (!jobId) {
        return;
    }

    const heartbeat = setInterval(() => {
        void touchKeywordJobLease(jobId);
    }, getHeartbeatMs());
    heartbeat.unref?.();

    let latestProgress = {
        stage: 'Preparing',
        label: 'Preparing',
        currentLayer: 0,
        totalLayers: TOTAL_LAYERS,
        completed: 0,
        total: TOTAL_LAYERS,
        percent: 0,
        message: `Preparing keyword research for "${jobRecord.seed}"`,
        provider: getRuntimeProviderLabel(),
    };

    try {
        const user = await loadJobUser(jobRecord);
        const startedAt = jobRecord.startedAt || new Date();
        await KeywordJob.findOneAndUpdate(
            { _id: jobId, leaseOwner: KEYWORD_WORKER_ID },
            {
                status: 'running',
                startedAt,
                progress: latestProgress,
                leaseExpiresAt: getLeaseExpiry(),
                lastHeartbeatAt: new Date(),
            }
        );

        const result = await runKeywordResearchV2(jobRecord.seed, {
            projectId: jobRecord.projectId || null,
            user,
            useAdsData: jobRecord.options?.useAdsData === true,
            onProgress: async (progress) => {
                latestProgress = {
                    stage: progress.stage,
                    label: progress.label,
                    currentLayer: progress.currentLayer,
                    totalLayers: progress.totalLayers,
                    completed: progress.completed,
                    total: progress.total,
                    percent: progress.percent,
                    message: progress.message,
                    provider: progress.provider || getRuntimeProviderLabel(),
                };
                await KeywordJob.findOneAndUpdate(
                    { _id: jobId, leaseOwner: KEYWORD_WORKER_ID },
                    {
                        status: 'running',
                        progress: latestProgress,
                        leaseExpiresAt: getLeaseExpiry(),
                        lastHeartbeatAt: new Date(),
                    }
                );
            },
        });

        await KeywordJob.findOneAndUpdate(
            { _id: jobId, leaseOwner: KEYWORD_WORKER_ID },
            {
                status: 'completed',
                progress: {
                    stage: 'Completed',
                    label: 'Completed',
                    currentLayer: TOTAL_LAYERS,
                    totalLayers: TOTAL_LAYERS,
                    completed: TOTAL_LAYERS,
                    total: TOTAL_LAYERS,
                    percent: 100,
                    message: `Completed keyword research for "${jobRecord.seed}"`,
                    provider: result.metadata?.provider || getRuntimeProviderLabel(),
                },
                result,
                error: '',
                completedAt: new Date(),
                leaseOwner: null,
                leaseExpiresAt: null,
                lastHeartbeatAt: new Date(),
            }
        );
    } catch (error) {
        await KeywordJob.findOneAndUpdate(
            { _id: jobId, leaseOwner: KEYWORD_WORKER_ID },
            {
                status: 'failed',
                error: error.message || 'Keyword research failed',
                completedAt: new Date(),
                progress: {
                    stage: 'Failed',
                    label: latestProgress.label || 'Failed',
                    currentLayer: latestProgress.currentLayer || 0,
                    totalLayers: latestProgress.totalLayers || TOTAL_LAYERS,
                    completed: latestProgress.completed || 0,
                    total: latestProgress.total || TOTAL_LAYERS,
                    percent: latestProgress.percent || 0,
                    message: error.message || 'Keyword research failed',
                    provider: latestProgress.provider || getRuntimeProviderLabel(),
                },
                leaseOwner: null,
                leaseExpiresAt: null,
                lastHeartbeatAt: new Date(),
            }
        );
    } finally {
        clearInterval(heartbeat);
        runningKeywordJobs.delete(jobId);
        void runKeywordWorkerTick();
    }
}

async function runKeywordWorkerTick() {
    while (runningKeywordJobs.size < getConcurrency()) {
        const claimed = await claimNextKeywordJob();
        if (!claimed) {
            break;
        }

        const jobId = claimed._id?.toString?.();
        if (!jobId || runningKeywordJobs.has(jobId)) {
            break;
        }

        runningKeywordJobs.add(jobId);
        void runKeywordJob(claimed);
    }
}

function startKeywordWorkerLoop() {
    if (keywordWorkerTimer) {
        return;
    }

    const pollMs = getPollMs();
    keywordWorkerTimer = setInterval(() => {
        void runKeywordWorkerTick();
    }, pollMs);
    keywordWorkerTimer.unref?.();
    void runKeywordWorkerTick();
}

async function initializeKeywordJobs() {
    startKeywordWorkerLoop();
}

async function createKeywordJob(seedInput, user, options = {}) {
    const seed = normalizeSeed(seedInput);
    if (!seed) {
        throw new Error('Seed keyword required');
    }

    const projectId = normalizeProjectId(options.projectId);
    const useAdsData = options.useAdsData === true;
    const doc = await KeywordJob.create({
        seed,
        projectId,
        options: { useAdsData },
        ownerEmail: user.email,
        status: 'queued',
        progress: {
            stage: 'Queued',
            label: 'Queued',
            currentLayer: 0,
            totalLayers: TOTAL_LAYERS,
            completed: 0,
            total: TOTAL_LAYERS,
            percent: 0,
            message: `Queued keyword research for "${seed}"`,
            provider: getRuntimeProviderLabel(),
        },
    });

    void runKeywordWorkerTick();
    return serializeJob(doc);
}

async function listKeywordJobs(user, options = {}) {
    const jobs = await KeywordJob.find(buildKeywordJobQuery(user, options)).sort({ createdAt: -1 }).limit(20).lean();
    return jobs.map((job) => serializeJob(job));
}

async function getKeywordJob(jobId, user, options = {}) {
    const job = await KeywordJob.findById(jobId).lean();
    if (!job || !canAccessKeywordJob(job, user)) {
        return null;
    }

    const projectId = normalizeProjectId(options.projectId);
    if (projectId && projectId !== job.projectId) {
        return null;
    }

    return serializeJob(job, { includeResult: options.includeResult === true });
}

module.exports = {
    initializeKeywordJobs,
    createKeywordJob,
    listKeywordJobs,
    getKeywordJob,
    __internal: {
        normalizeProjectId,
        normalizeSeed,
        buildKeywordJobQuery,
        canAccessKeywordJob,
        loadJobUser,
        parsePositiveInt,
    },
};
