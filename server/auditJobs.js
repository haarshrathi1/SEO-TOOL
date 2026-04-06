const { AuditJob } = require('./models');
const auditHistory = require('./auditHistory');
const crawler = require('./crawler');
const { getProject } = require('./projects');

const AUDIT_WORKER_ID = `audit-worker:${process.pid}`;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 30 * 1000;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_CONCURRENCY = 1;
const ACTIVE_AUDIT_STATUSES = ['queued', 'running'];

let auditWorkerTimer = null;
const runningAuditJobs = new Set();

function parsePositiveInt(value, fallback) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return fallback;
    }
    return Math.floor(parsed);
}

function getLeaseMs() {
    return parsePositiveInt(process.env.AUDIT_JOB_LEASE_MS, DEFAULT_LEASE_MS);
}

function getHeartbeatMs() {
    return parsePositiveInt(process.env.AUDIT_JOB_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS);
}

function getPollMs() {
    return parsePositiveInt(process.env.AUDIT_JOB_POLL_MS, DEFAULT_POLL_MS);
}

function getConcurrency() {
    return parsePositiveInt(process.env.AUDIT_JOB_WORKER_CONCURRENCY, DEFAULT_CONCURRENCY);
}

function getLeaseExpiry(date = new Date()) {
    return new Date(date.getTime() + getLeaseMs());
}

function normalizeProjectId(projectId) {
    return typeof projectId === 'string' && projectId.trim() ? projectId.trim() : null;
}

function buildAuditJobListQuery(user, options = {}) {
    const projectId = normalizeProjectId(options.projectId);
    const query = {};

    if (user?.role === 'admin') {
        if (projectId) {
            query.projectId = projectId;
        }
        return query;
    }

    if (!Array.isArray(user?.projectIds) || user.projectIds.length === 0) {
        return null;
    }

    if (projectId) {
        if (!user.projectIds.includes(projectId)) {
            return null;
        }
        query.projectId = projectId;
    } else {
        query.projectId = { $in: user.projectIds };
    }

    return query;
}

function canAccessAuditJob(job, user) {
    if (!job) {
        return false;
    }

    if (user?.role === 'admin') {
        return true;
    }

    return Array.isArray(user?.projectIds) && user.projectIds.includes(job.projectId);
}

function serializeJob(record, options = {}) {
    const job = typeof record.toObject === 'function' ? record.toObject() : record;
    return {
        id: job._id?.toString?.() || job.id,
        projectId: job.projectId,
        ownerEmail: job.ownerEmail,
        status: job.status,
        progress: job.progress,
        error: job.error || '',
        auditHistoryId: job.auditHistoryId || null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: options.includeResult ? (job.result || null) : undefined,
    };
}

async function touchAuditJobLease(jobId) {
    const now = new Date();
    await AuditJob.findOneAndUpdate(
        {
            _id: jobId,
            leaseOwner: AUDIT_WORKER_ID,
            status: 'running',
        },
        {
            leaseExpiresAt: getLeaseExpiry(now),
            lastHeartbeatAt: now,
        }
    );
}

async function claimNextAuditJob() {
    const now = new Date();
    const claimed = await AuditJob.findOneAndUpdate(
        {
            status: { $in: ACTIVE_AUDIT_STATUSES },
            $or: [
                { leaseExpiresAt: { $exists: false } },
                { leaseExpiresAt: null },
                { leaseExpiresAt: { $lte: now } },
            ],
        },
        {
            $set: {
                status: 'running',
                leaseOwner: AUDIT_WORKER_ID,
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

async function runAuditJob(jobRecord) {
    const jobId = jobRecord._id?.toString?.() || String(jobRecord._id || jobRecord.id || '');
    if (!jobId) {
        return;
    }

    const heartbeat = setInterval(() => {
        void touchAuditJobLease(jobId);
    }, getHeartbeatMs());
    heartbeat.unref?.();

    let latestProgress = {
        stage: 'Preparing crawl',
        completed: 0,
        total: 0,
        percent: 0,
        message: `Preparing crawl for ${jobRecord.projectId}`,
        currentUrl: '',
    };

    try {
        const project = await getProject(jobRecord.projectId);
        if (!project) {
            await AuditJob.findOneAndUpdate(
                { _id: jobId, leaseOwner: AUDIT_WORKER_ID },
                {
                    status: 'failed',
                    error: 'Project not found',
                    completedAt: new Date(),
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    lastHeartbeatAt: new Date(),
                }
            );
            return;
        }

        latestProgress = {
            ...latestProgress,
            message: `Preparing crawl for ${project.name}`,
        };

        await AuditJob.findOneAndUpdate(
            { _id: jobId, leaseOwner: AUDIT_WORKER_ID },
            {
                status: 'running',
                startedAt: jobRecord.startedAt || new Date(),
                progress: latestProgress,
                leaseExpiresAt: getLeaseExpiry(),
                lastHeartbeatAt: new Date(),
            }
        );

        const results = await crawler.crawlSite(project.url, {
            maxPages: project.auditMaxPages || 200,
            ga4PropertyId: project.ga4PropertyId || '',
            onProgress: async (progress) => {
                latestProgress = {
                    stage: progress.stage,
                    completed: progress.completed,
                    total: progress.total,
                    percent: progress.percent,
                    message: progress.message,
                    currentUrl: progress.currentUrl || '',
                };

                await AuditJob.findOneAndUpdate(
                    { _id: jobId, leaseOwner: AUDIT_WORKER_ID },
                    {
                        status: 'running',
                        progress: latestProgress,
                        leaseExpiresAt: getLeaseExpiry(),
                        lastHeartbeatAt: new Date(),
                    }
                );
            },
        });

        const historyRecord = await auditHistory.addAudit(results, project.id);
        await AuditJob.findOneAndUpdate(
            { _id: jobId, leaseOwner: AUDIT_WORKER_ID },
            {
                status: 'completed',
                progress: {
                    stage: 'Completed',
                    completed: results.length,
                    total: results.length,
                    percent: 100,
                    message: `Completed audit for ${project.name}`,
                    currentUrl: '',
                },
                result: results,
                auditHistoryId: historyRecord?.id || null,
                error: '',
                completedAt: new Date(),
                leaseOwner: null,
                leaseExpiresAt: null,
                lastHeartbeatAt: new Date(),
            }
        );
    } catch (error) {
        await AuditJob.findOneAndUpdate(
            { _id: jobId, leaseOwner: AUDIT_WORKER_ID },
            {
                status: 'failed',
                error: error.message || 'Audit failed',
                completedAt: new Date(),
                progress: {
                    stage: 'Failed',
                    completed: latestProgress.completed || 0,
                    total: latestProgress.total || 0,
                    percent: latestProgress.percent || 0,
                    message: error.message || 'Audit failed',
                    currentUrl: latestProgress.currentUrl || '',
                },
                leaseOwner: null,
                leaseExpiresAt: null,
                lastHeartbeatAt: new Date(),
            }
        );
    } finally {
        clearInterval(heartbeat);
        runningAuditJobs.delete(jobId);
        void runAuditWorkerTick();
    }
}

async function runAuditWorkerTick() {
    while (runningAuditJobs.size < getConcurrency()) {
        const claimed = await claimNextAuditJob();
        if (!claimed) {
            break;
        }

        const jobId = claimed._id?.toString?.();
        if (!jobId || runningAuditJobs.has(jobId)) {
            break;
        }

        runningAuditJobs.add(jobId);
        void runAuditJob(claimed);
    }
}

function startAuditWorkerLoop() {
    if (auditWorkerTimer) {
        return;
    }

    auditWorkerTimer = setInterval(() => {
        void runAuditWorkerTick();
    }, getPollMs());
    auditWorkerTimer.unref?.();
    void runAuditWorkerTick();
}

async function initializeAuditJobs() {
    startAuditWorkerLoop();
}

async function createAuditJob(projectId, user) {
    const project = await getProject(projectId, user);
    if (!project) {
        throw new Error('Project not found');
    }

    const doc = await AuditJob.create({
        projectId: project.id,
        ownerEmail: user.email,
        status: 'queued',
        progress: {
            stage: 'Queued',
            completed: 0,
            total: 0,
            percent: 0,
            message: `Queued audit for ${project.name}`,
            currentUrl: '',
        },
    });

    void runAuditWorkerTick();
    return serializeJob(doc);
}

async function listAuditJobs(user, options = {}) {
    const query = buildAuditJobListQuery(user, options);
    if (!query) {
        return [];
    }

    const jobs = await AuditJob.find(query).sort({ createdAt: -1 }).limit(20).lean();
    return jobs.map((job) => serializeJob(job));
}

async function getAuditJob(jobId, user, options = {}) {
    const job = await AuditJob.findById(jobId).lean();
    if (!job || !canAccessAuditJob(job, user)) {
        return null;
    }

    const projectId = normalizeProjectId(options.projectId);
    if (projectId && projectId !== job.projectId) {
        return null;
    }

    return serializeJob(job, { includeResult: options.includeResult === true });
}

module.exports = {
    initializeAuditJobs,
    createAuditJob,
    listAuditJobs,
    getAuditJob,
    __internal: {
        normalizeProjectId,
        buildAuditJobListQuery,
        canAccessAuditJob,
        parsePositiveInt,
    },
};
