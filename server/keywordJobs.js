const { AdminUser, KeywordJob, Viewer } = require('./models');
const { runKeywordResearchV2, TOTAL_LAYERS, getRuntimeProviderLabel } = require('./keywordResearchService');

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

async function initializeKeywordJobs() {
    await KeywordJob.updateMany(
        { status: { $in: ['queued', 'running'] } },
        {
            status: 'failed',
            error: 'Job interrupted by a server restart.',
            completedAt: new Date(),
        }
    );
}

function queueKeywordJob(jobId) {
    setImmediate(() => {
        void runKeywordJob(jobId);
    });
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

    queueKeywordJob(doc._id.toString());
    return serializeJob(doc);
}

async function runKeywordJob(jobId) {
    const job = await KeywordJob.findById(jobId);
    if (!job) {
        return;
    }

    const user = await loadJobUser(job);

    job.status = 'running';
    job.startedAt = new Date();
    job.progress = {
        ...job.progress,
        stage: 'Preparing',
        label: 'Preparing',
        message: `Preparing keyword research for "${job.seed}"`,
    };
    await job.save();
    let latestProgress = { ...job.progress };

    try {
        const result = await runKeywordResearchV2(job.seed, {
            projectId: job.projectId || null,
            user,
            useAdsData: job.options?.useAdsData === true,
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
                await KeywordJob.findByIdAndUpdate(jobId, {
                    status: 'running',
                    progress: latestProgress,
                });
            },
        });

        await KeywordJob.findByIdAndUpdate(jobId, {
            status: 'completed',
            progress: {
                stage: 'Completed',
                label: 'Completed',
                currentLayer: TOTAL_LAYERS,
                totalLayers: TOTAL_LAYERS,
                completed: TOTAL_LAYERS,
                total: TOTAL_LAYERS,
                percent: 100,
                message: `Completed keyword research for "${job.seed}"`,
                provider: result.metadata?.provider || getRuntimeProviderLabel(),
            },
            result,
            error: '',
            completedAt: new Date(),
        });
    } catch (error) {
        await KeywordJob.findByIdAndUpdate(jobId, {
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
        });
    }
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
    },
};
