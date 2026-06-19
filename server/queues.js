const { config } = require('./config');
const { logger } = require('./logger');

const QUEUE_NAMES = {
    audit: 'audit-runs',
    keyword: 'keyword-runs',
};

let redisConnection = null;
const queues = new Map();
const workers = [];
let BullQueue = null;
let BullWorker = null;
let RedisClient = null;

function isBullQueueEnabled() {
    return config.queue.mode === 'bullmq' && Boolean(config.queue.redisUrl);
}

function getRedisConnection() {
    if (!isBullQueueEnabled()) {
        return null;
    }

    if (!RedisClient) {
        // Lazy-load so tests and inline mode do not require Redis packages at import time.
        // eslint-disable-next-line global-require
        RedisClient = require('ioredis');
    }

    if (!redisConnection) {
        redisConnection = new RedisClient(config.queue.redisUrl, {
            maxRetriesPerRequest: null,
        });
        redisConnection.on('error', (error) => {
            logger.error('queue.redis_error', {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }

    return redisConnection;
}

function getQueue(name) {
    if (!isBullQueueEnabled()) {
        return null;
    }

    if (!BullQueue) {
        // eslint-disable-next-line global-require
        ({ Queue: BullQueue } = require('bullmq'));
    }

    if (!queues.has(name)) {
        queues.set(name, new BullQueue(name, {
            connection: getRedisConnection(),
        }));
    }

    return queues.get(name);
}

async function enqueueJob(name, data, options = {}) {
    const queue = getQueue(name);
    if (!queue) {
        return null;
    }

    const job = await queue.add(name, data, {
        jobId: options.jobId,
        attempts: options.attempts || 3,
        removeOnComplete: { count: 100 },
        removeOnFail: { count: 500 },
        backoff: {
            type: 'exponential',
            delay: 1000,
        },
    });

    return String(job.id || '');
}

function startWorker(name, processor, options = {}) {
    const connection = getRedisConnection();
    if (!connection) {
        return null;
    }

    if (!BullWorker) {
        // eslint-disable-next-line global-require
        ({ Worker: BullWorker } = require('bullmq'));
    }

    const worker = new BullWorker(name, async (job) => processor(job), {
        connection,
        concurrency: options.concurrency || 1,
    });

    worker.on('failed', (job, error) => {
        logger.error('queue.job_failed', {
            queue: name,
            jobId: job?.id || '',
            error: error instanceof Error ? error.message : String(error),
        });
    });
    worker.on('completed', (job) => {
        logger.info('queue.job_completed', {
            queue: name,
            jobId: job?.id || '',
        });
    });

    workers.push(worker);
    return worker;
}

async function closeQueues() {
    await Promise.all(workers.map((worker) => worker.close()));
    await Promise.all([...queues.values()].map((queue) => queue.close()));
    if (redisConnection) {
        await redisConnection.quit();
    }
}

module.exports = {
    QUEUE_NAMES,
    closeQueues,
    enqueueJob,
    getQueue,
    isBullQueueEnabled,
    startWorker,
};
