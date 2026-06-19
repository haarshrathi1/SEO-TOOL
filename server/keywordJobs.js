const { KeywordJob, User, WorkspaceMembership } = require('./models');
const { runKeywordResearchV2, TOTAL_LAYERS, getRuntimeProviderLabel } = require('./keywordResearchService');
const { persistKeywordResearchResult } = require('./keywordResearchPersistence');
const { logger } = require('./logger');
const { recordAuditEvent } = require('./auditEvents');
const { QUEUE_NAMES, enqueueJob, isBullQueueEnabled, startWorker } = require('./queues');

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
    const query = {};
    if (user?.workspaceId) {
        query.workspaceId = user.workspaceId;
    }
    const projectId = normalizeProjectId(options.projectId);
    if (projectId) {
        query.projectId = projectId;
    }

    const effectiveRole = user?.workspaceRole || user?.role;
    if (effectiveRole === 'viewer') {
        if (!Array.isArray(user.projectIds) || user.projectIds.length === 0) {
            return null;
        }

        if (projectId) {
            if (!user.projectIds.includes(projectId)) {
                return null;
            }
        } else {
            query.projectId = { $in: user.projectIds };
        }
    }

    return query;
}

function canAccessKeywordJob(job, user) {
    if (!job || !user) {
        return false;
    }

    if (user.workspaceId && String(job.workspaceId || '') !== String(user.workspaceId || '')) {
        return false;
    }

    const effectiveRole = user.workspaceRole || user.role;
    if (effectiveRole !== 'viewer') {
        return true;
    }

    if (!job.projectId) {
        return false;
    }

    return Array.isArray(user.projectIds) && user.projectIds.includes(job.projectId);
}

async function loadJobUser(job) {
    const email = String(job?.ownerEmail || '').toLowerCase().trim();
    if (!email || !job?.workspaceId) {
        return null;
    }

    const user = await User.findOne({ email }).lean();
    if (!user) {
        return null;
    }

    const membership = await WorkspaceMembership.findOne({
        workspaceId: job.workspaceId,
        userId: user._id,
        status: { $ne: 'revoked' },
    }).lean();
    if (!membership) {
        return null;
    }

    return {
        email,
        role: membership.role === 'viewer' ? 'viewer' : 'admin',
        workspaceRole: membership.role,
        workspaceId: String(job.workspaceId),
        userId: String(user._id),
        access: Array.isArray(membership.access) ? membership.access : ['keywords'],
        features: Array.isArray(membership.features) ? membership.features : [],
        projectIds: Array.isArray(membership.projectIds) ? membership.projectIds : [],
    };
}

function serializeJob(record, options = {}) {
    const job = typeof record.toObject === 'function' ? record.toObject() : record;
    return {
        id: job._id?.toString?.() || job.id,
        workspaceId: String(job.workspaceId || ''),
        seed: job.seed,
        projectId: job.projectId || null,
        ownerEmail: job.ownerEmail,
        status: job.status,
        progress: job.progress,
        summary: {
            seed: job.seed,
            provider: job.progress?.provider || getRuntimeProviderLabel(),
        },
        error: job.error || '',
        keywordHistoryId: job.keywordHistoryId || null,
        historySaveError: job.historySaveError || '',
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: options.includeResult ? (job.result || null) : undefined,
    };
}

async function touchKeywordJobLease(jobId, leaseOwner = KEYWORD_WORKER_ID) {
    const now = new Date();
    await KeywordJob.findOneAndUpdate(
        {
            _id: jobId,
            leaseOwner,
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

async function runKeywordJob(jobRecord, options = {}) {
    const jobId = jobRecord._id?.toString?.() || String(jobRecord._id || jobRecord.id || '');
    const leaseOwner = options.leaseOwner || KEYWORD_WORKER_ID;
    if (!jobId) {
        return;
    }

    const heartbeat = setInterval(() => {
        void touchKeywordJobLease(jobId, leaseOwner);
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
            { _id: jobId },
            {
                status: 'running',
                startedAt,
                progress: latestProgress,
                leaseOwner,
                leaseStartedAt: new Date(),
                leaseExpiresAt: getLeaseExpiry(),
                lastHeartbeatAt: new Date(),
            }
        );

        const result = await runKeywordResearchV2(jobRecord.seed, {
            projectId: jobRecord.projectId || null,
            user,
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
                    { _id: jobId },
                    {
                        status: 'running',
                        progress: latestProgress,
                        leaseExpiresAt: getLeaseExpiry(),
                        lastHeartbeatAt: new Date(),
                    }
                );
            },
        });
        const persistence = await persistKeywordResearchResult(user, result, {
            projectId: jobRecord.projectId || null,
        });

        await KeywordJob.findOneAndUpdate(
            { _id: jobId },
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
                keywordHistoryId: persistence.keywordHistoryId,
                historySaveError: persistence.historySaveError,
                error: '',
                completedAt: new Date(),
                leaseOwner: null,
                leaseExpiresAt: null,
                lastHeartbeatAt: new Date(),
            }
        );

        await recordAuditEvent({
            workspaceId: jobRecord.workspaceId,
            action: 'keyword.completed',
            entityType: 'keywordJob',
            entityId: jobId,
            metadata: { projectId: jobRecord.projectId || null, seed: jobRecord.seed },
        });
    } catch (error) {
        await KeywordJob.findOneAndUpdate(
            { _id: jobId },
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
                keywordHistoryId: null,
                historySaveError: '',
                leaseOwner: null,
                leaseExpiresAt: null,
                lastHeartbeatAt: new Date(),
            }
        );

        logger.error('keyword.job_failed', {
            keywordJobId: jobId,
            projectId: jobRecord.projectId || null,
            error: error instanceof Error ? error.message : String(error),
        });
    } finally {
        clearInterval(heartbeat);
        runningKeywordJobs.delete(jobId);
        if (!isBullQueueEnabled()) {
            void runKeywordWorkerTick();
        }
    }
}

async function processQueuedKeywordJob(keywordJobId) {
    const record = await KeywordJob.findByIdAndUpdate(
        keywordJobId,
        {
            $set: {
                status: 'running',
                leaseOwner: KEYWORD_WORKER_ID,
                leaseStartedAt: new Date(),
                leaseExpiresAt: getLeaseExpiry(),
                lastHeartbeatAt: new Date(),
                error: '',
                completedAt: null,
            },
            $inc: { attemptCount: 1 },
        },
        { new: true }
    ).lean();

    if (!record) {
        return null;
    }

    await runKeywordJob(record, { leaseOwner: KEYWORD_WORKER_ID });
    return null;
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

async function initializeKeywordJobs(options = {}) {
    if (options.startWorkers !== true) {
        return;
    }

    if (isBullQueueEnabled()) {
        startWorker(QUEUE_NAMES.keyword, async (job) => {
            await processQueuedKeywordJob(job.data.keywordJobId);
        }, {
            concurrency: getConcurrency(),
        });
        return;
    }

    startKeywordWorkerLoop();
}

async function createKeywordJob(seedInput, user, options = {}) {
    const seed = normalizeSeed(seedInput);
    if (!seed) {
        throw new Error('Seed keyword required');
    }

    const projectId = normalizeProjectId(options.projectId);
    if (user?.workspaceRole === 'viewer') {
        if (!projectId || !Array.isArray(user.projectIds) || !user.projectIds.includes(projectId)) {
            throw new Error('Project access denied');
        }
    }

    const doc = await KeywordJob.create({
        workspaceId: user.workspaceId,
        seed,
        projectId,
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
        keywordHistoryId: null,
        historySaveError: '',
    });

    let queueJobId = null;
    if (isBullQueueEnabled()) {
        queueJobId = await enqueueJob(QUEUE_NAMES.keyword, {
            keywordJobId: String(doc._id),
        }, {
            jobId: String(doc._id),
        });
        if (queueJobId) {
            doc.set({ queueJobId });
            await doc.save();
        }
    }

    await recordAuditEvent({
        workspaceId: user.workspaceId,
        userId: user.userId,
        action: 'keyword.created',
        entityType: 'keywordJob',
        entityId: String(doc._id),
        metadata: { seed, projectId },
    });

    return serializeJob(doc);
}

async function listKeywordJobs(user, options = {}) {
    const query = buildKeywordJobQuery(user, options);
    if (!query) {
        return [];
    }

    const jobs = await KeywordJob.find(query).sort({ createdAt: -1 }).limit(20).lean();
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
        buildKeywordJobQuery,
        canAccessKeywordJob,
        loadJobUser,
        normalizeProjectId,
        normalizeSeed,
        parsePositiveInt,
        serializeJob,
    },
};
