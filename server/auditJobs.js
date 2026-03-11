const { AuditJob } = require('./models');
const auditHistory = require('./auditHistory');
const crawler = require('./crawler');
const { getProject } = require('./projects');

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

async function initializeAuditJobs() {
    await AuditJob.updateMany(
        { status: { $in: ['queued', 'running'] } },
        {
            status: 'failed',
            error: 'Job interrupted by a server restart.',
            completedAt: new Date(),
        }
    );
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

    queueAuditJob(doc._id.toString());
    return serializeJob(doc);
}

function queueAuditJob(jobId) {
    setImmediate(() => {
        void runAuditJob(jobId);
    });
}

async function runAuditJob(jobId) {
    const job = await AuditJob.findById(jobId);
    if (!job) {
        return;
    }

    const project = await getProject(job.projectId);
    if (!project) {
        job.status = 'failed';
        job.error = 'Project not found';
        job.completedAt = new Date();
        await job.save();
        return;
    }

    job.status = 'running';
    job.startedAt = new Date();
    job.progress = {
        ...job.progress,
        stage: 'Preparing crawl',
        message: `Preparing crawl for ${project.name}`,
    };
    await job.save();

    try {
        const results = await crawler.crawlSite(project.url, {
            maxPages: project.auditMaxPages || 200,
            onProgress: async (progress) => {
                await AuditJob.findByIdAndUpdate(jobId, {
                    status: 'running',
                    progress: {
                        stage: progress.stage,
                        completed: progress.completed,
                        total: progress.total,
                        percent: progress.percent,
                        message: progress.message,
                        currentUrl: progress.currentUrl || '',
                    },
                });
            },
        });

        const historyRecord = await auditHistory.addAudit(results, project.id);
        await AuditJob.findByIdAndUpdate(jobId, {
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
        });
    } catch (error) {
        await AuditJob.findByIdAndUpdate(jobId, {
            status: 'failed',
            error: error.message || 'Audit failed',
            completedAt: new Date(),
            progress: {
                stage: 'Failed',
                completed: job.progress?.completed || 0,
                total: job.progress?.total || 0,
                percent: job.progress?.percent || 0,
                message: error.message || 'Audit failed',
                currentUrl: '',
            },
        });
    }
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
    },
};
