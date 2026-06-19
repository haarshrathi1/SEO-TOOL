const {
    AuditIssue,
    AuditJob,
    AuditSnapshot,
} = require('./models');
const auditHistory = require('./auditHistory');
const crawler = require('./crawler');
const { getProject } = require('./projects');
const auth = require('./auth');
const { logger } = require('./logger');
const { recordAuditEvent } = require('./auditEvents');
const { QUEUE_NAMES, enqueueJob, isBullQueueEnabled, startWorker } = require('./queues');
const { annotateTechnicalIssues, collectTechnicalIssues } = require('./auditIssueDetector');

const AUDIT_WORKER_ID = `audit-worker:${process.pid}`;
const DEFAULT_LEASE_MS = 5 * 60 * 1000;
const DEFAULT_HEARTBEAT_MS = 30 * 1000;
const DEFAULT_POLL_MS = 2000;
const DEFAULT_CONCURRENCY = 1;
const ACTIVE_AUDIT_STATUSES = ['queued', 'running'];

let auditWorkerTimer = null;
const runningAuditJobs = new Set();
const cancelledAuditJobs = new Set();

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

    if (user?.workspaceId) {
        query.workspaceId = user.workspaceId;
    }

    if (projectId) {
        query.projectId = projectId;
    }

    const effectiveRole = user?.workspaceRole || user?.role;
    if (effectiveRole === 'viewer') {
        if (!Array.isArray(user?.projectIds) || user.projectIds.length === 0) {
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

function canAccessAuditJob(job, user) {
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

    return Array.isArray(user?.projectIds) && user.projectIds.includes(job.projectId);
}

function serializeJob(record, options = {}) {
    const job = typeof record.toObject === 'function' ? record.toObject() : record;
    return {
        id: job._id?.toString?.() || job.id,
        workspaceId: String(job.workspaceId || ''),
        projectId: job.projectId,
        ownerEmail: job.ownerEmail,
        status: job.status,
        progress: job.progress,
        summary: job.summary || {
            crawledUrls: 0,
            inspectedUrls: 0,
            psiSampledUrls: 0,
            brokenLinkChecks: 0,
            issuesBySeverity: {},
        },
        mode: job.mode || 'standard',
        error: job.error || '',
        auditHistoryId: job.auditHistoryId || null,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        result: options.includeResult ? (job.result || null) : undefined,
    };
}

function buildAuditArtifacts(results = []) {
    annotateTechnicalIssues(results);
    const summary = {
        crawledUrls: Array.isArray(results) ? results.length : 0,
        inspectedUrls: Array.isArray(results) ? results.length : 0,
        psiSampledUrls: Array.isArray(results) ? results.filter((result) => result?.psi_data).length : 0,
        brokenLinkChecks: Array.isArray(results)
            ? results.reduce((sum, result) => sum + (Array.isArray(result?.brokenLinks) ? result.brokenLinks.length : 0), 0)
            : 0,
        issuesBySeverity: {
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            info: 0,
        },
    };
    const issues = [];

    for (const result of Array.isArray(results) ? results : []) {
        if (!result || typeof result !== 'object') {
            continue;
        }

        const pageIssues = Array.isArray(result.technicalIssues) && result.technicalIssues.length > 0
            ? result.technicalIssues
            : collectTechnicalIssues(result);

        for (const pageIssue of pageIssues) {
            issues.push({
                url: result.url,
                category: pageIssue.category,
                severity: pageIssue.severity,
                title: pageIssue.title,
                details: pageIssue.details,
                metadata: {
                    issueId: pageIssue.id,
                    ...(pageIssue.metadata || {}),
                },
            });
            if (Object.prototype.hasOwnProperty.call(summary.issuesBySeverity, pageIssue.severity)) {
                summary.issuesBySeverity[pageIssue.severity] += 1;
            }
        }
    }

    return { summary, issues };
}

async function persistAuditArtifacts(jobRecord, results) {
    const { summary, issues } = buildAuditArtifacts(results);

    await Promise.all([
        AuditSnapshot.create({
            workspaceId: jobRecord.workspaceId,
            projectId: jobRecord.projectId,
            auditJobId: jobRecord._id,
            summary,
            metadata: {},
        }),
        issues.length > 0
            ? AuditIssue.insertMany(issues.map((issue) => ({
                workspaceId: jobRecord.workspaceId,
                projectId: jobRecord.projectId,
                auditJobId: jobRecord._id,
                ...issue,
            })), { ordered: false })
            : Promise.resolve([]),
    ]);

    return summary;
}

async function touchAuditJobLease(jobId, leaseOwner = AUDIT_WORKER_ID) {
    const now = new Date();
    await AuditJob.findOneAndUpdate(
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

async function runAuditJob(jobRecord, options = {}) {
    const jobId = jobRecord._id?.toString?.() || String(jobRecord._id || jobRecord.id || '');
    const leaseOwner = options.leaseOwner || AUDIT_WORKER_ID;
    if (!jobId) {
        return;
    }

    const heartbeat = setInterval(() => {
        void touchAuditJobLease(jobId, leaseOwner);
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
        const project = await getProject(jobRecord.projectId, null, { workspaceId: jobRecord.workspaceId });
        if (!project) {
            await AuditJob.findOneAndUpdate(
                { _id: jobId },
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
        const authClient = await auth.getProjectAuthClient(project);
        if (!authClient) {
            throw new Error('Google service not authenticated for this project. Connect Google from the project setup page first.');
        }

        await AuditJob.findOneAndUpdate(
            { _id: jobId },
            {
                status: 'running',
                startedAt: jobRecord.startedAt || new Date(),
                progress: latestProgress,
                leaseOwner,
                leaseStartedAt: new Date(),
                leaseExpiresAt: getLeaseExpiry(),
                lastHeartbeatAt: new Date(),
            }
        );

        const results = await crawler.crawlSite(project.url, {
            maxPages: project.auditMaxPages || 200,
            ga4PropertyId: project.ga4PropertyId || '',
            gscSiteUrl: project.gscSiteUrl || project.url,
            authClient,
            gscDeep: jobRecord.mode === 'gsc-deep',
            onProgress: async (progress) => {
                if (cancelledAuditJobs.has(jobId)) {
                    throw new Error('AUDIT_CANCELLED');
                }

                latestProgress = {
                    stage: progress.stage,
                    completed: progress.completed,
                    total: progress.total,
                    percent: progress.percent,
                    message: progress.message,
                    currentUrl: progress.currentUrl || '',
                };

                await AuditJob.findOneAndUpdate(
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

        const [historyRecord, summary] = await Promise.all([
            auditHistory.addAudit(results, project.id, jobRecord.workspaceId),
            persistAuditArtifacts(jobRecord, results),
        ]);
        await AuditJob.findOneAndUpdate(
            { _id: jobId },
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
                summary,
                auditHistoryId: historyRecord?.id || null,
                error: '',
                completedAt: new Date(),
                leaseOwner: null,
                leaseExpiresAt: null,
                lastHeartbeatAt: new Date(),
            }
        );

        await recordAuditEvent({
            workspaceId: jobRecord.workspaceId,
            action: 'audit.completed',
            entityType: 'auditJob',
            entityId: jobId,
            metadata: { projectId: jobRecord.projectId },
        });
    } catch (error) {
        const wasCancelled = error?.message === 'AUDIT_CANCELLED' || cancelledAuditJobs.has(jobId);

        if (wasCancelled) {
            await AuditJob.findOneAndUpdate(
                { _id: jobId },
                {
                    status: 'cancelled',
                    error: '',
                    completedAt: new Date(),
                    progress: {
                        stage: 'Cancelled',
                        completed: latestProgress.completed || 0,
                        total: latestProgress.total || 0,
                        percent: latestProgress.percent || 0,
                        message: 'Audit was cancelled',
                        currentUrl: '',
                    },
                    leaseOwner: null,
                    leaseExpiresAt: null,
                    lastHeartbeatAt: new Date(),
                }
            );

            logger.info('audit.job_cancelled', {
                auditJobId: jobId,
                projectId: jobRecord.projectId,
            });
        } else {
            await AuditJob.findOneAndUpdate(
                { _id: jobId },
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

            logger.error('audit.job_failed', {
                auditJobId: jobId,
                projectId: jobRecord.projectId,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    } finally {
        clearInterval(heartbeat);
        cancelledAuditJobs.delete(jobId);
        runningAuditJobs.delete(jobId);
        if (!isBullQueueEnabled()) {
            void runAuditWorkerTick();
        }
    }
}

async function processQueuedAuditJob(auditJobId) {
    const record = await AuditJob.findByIdAndUpdate(
        auditJobId,
        {
            $set: {
                status: 'running',
                leaseOwner: AUDIT_WORKER_ID,
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

    await runAuditJob(record, { leaseOwner: AUDIT_WORKER_ID });
    return null;
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

async function initializeAuditJobs(options = {}) {
    if (options.startWorkers !== true) {
        return;
    }

    if (isBullQueueEnabled()) {
        startWorker(QUEUE_NAMES.audit, async (job) => {
            await processQueuedAuditJob(job.data.auditJobId);
        }, {
            concurrency: getConcurrency(),
        });
        return;
    }

    startAuditWorkerLoop();
}

async function createAuditJob(projectId, user) {
    const project = await getProject(projectId, user);
    if (!project) {
        throw new Error('Project not found');
    }

    const doc = await AuditJob.create({
        workspaceId: user.workspaceId,
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
        summary: {
            crawledUrls: 0,
            inspectedUrls: 0,
            psiSampledUrls: 0,
            brokenLinkChecks: 0,
            issuesBySeverity: {},
        },
    });

    let queueJobId = null;
    if (isBullQueueEnabled()) {
        queueJobId = await enqueueJob(QUEUE_NAMES.audit, {
            auditJobId: String(doc._id),
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
        action: 'audit.created',
        entityType: 'auditJob',
        entityId: String(doc._id),
        metadata: { projectId: project.id },
    });

    return serializeJob(doc);
}

async function createGscDeepAuditJob(projectId, user) {
    const project = await getProject(projectId, user);
    if (!project) {
        throw new Error('Project not found');
    }

    const doc = await AuditJob.create({
        workspaceId: user.workspaceId,
        projectId: project.id,
        ownerEmail: user.email,
        mode: 'gsc-deep',
        status: 'queued',
        progress: {
            stage: 'Queued',
            completed: 0,
            total: 0,
            percent: 0,
            message: `Queued GSC deep audit for ${project.name}`,
            currentUrl: '',
        },
        summary: {
            crawledUrls: 0,
            inspectedUrls: 0,
            psiSampledUrls: 0,
            brokenLinkChecks: 0,
            issuesBySeverity: {},
        },
    });

    if (isBullQueueEnabled()) {
        const queueJobId = await enqueueJob(QUEUE_NAMES.audit, {
            auditJobId: String(doc._id),
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
        action: 'audit.created',
        entityType: 'auditJob',
        entityId: String(doc._id),
        metadata: { projectId: project.id, mode: 'gsc-deep' },
    });

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

async function cancelAuditJob(jobId, user) {
    const job = await AuditJob.findById(jobId).lean();
    if (!job || !canAccessAuditJob(job, user)) {
        return null;
    }

    if (!['queued', 'running'].includes(job.status)) {
        return serializeJob(job);
    }

    const updated = await AuditJob.findOneAndUpdate(
        { _id: jobId, status: { $in: ['queued', 'running'] } },
        {
            status: 'cancelled',
            error: '',
            completedAt: new Date(),
            progress: {
                stage: 'Cancelled',
                completed: job.progress?.completed || 0,
                total: job.progress?.total || 0,
                percent: job.progress?.percent || 0,
                message: 'Audit was cancelled',
                currentUrl: '',
            },
            leaseOwner: null,
            leaseExpiresAt: null,
            lastHeartbeatAt: new Date(),
        },
        { new: true }
    ).lean();

    if (updated) {
        cancelledAuditJobs.add(String(jobId));
    }

    return updated ? serializeJob(updated) : serializeJob(job);
}

module.exports = {
    initializeAuditJobs,
    createAuditJob,
    createGscDeepAuditJob,
    listAuditJobs,
    getAuditJob,
    cancelAuditJob,
    __internal: {
        buildAuditArtifacts,
        buildAuditJobListQuery,
        canAccessAuditJob,
        normalizeProjectId,
        parsePositiveInt,
        serializeJob,
    },
};
