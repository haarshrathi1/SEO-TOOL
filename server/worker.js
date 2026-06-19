const { assertCoreConfig } = require('./config');
const { logger } = require('./logger');
const { connectMongo } = require('./db');
const auth = require('./auth');
const auditJobs = require('./auditJobs');
const keywordJobs = require('./keywordJobs');

async function startWorker() {
    assertCoreConfig();
    await connectMongo();
    await auth.initializeAuth();
    await Promise.all([
        auditJobs.initializeAuditJobs({ startWorkers: true }),
        keywordJobs.initializeKeywordJobs({ startWorkers: true }),
    ]);

    logger.info('worker.started', {
        pid: process.pid,
    });
}

process.on('uncaughtException', (error) => {
    logger.error('worker.uncaught_exception', {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});

process.on('unhandledRejection', (reason) => {
    logger.error('worker.unhandled_rejection', {
        error: reason instanceof Error ? reason.message : String(reason),
    });
    process.exit(1);
});

startWorker().catch((error) => {
    logger.error('worker.start_failed', {
        error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
});
