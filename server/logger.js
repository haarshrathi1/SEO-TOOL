function formatPayload(level, message, meta = {}) {
    return JSON.stringify({
        level,
        message,
        time: new Date().toISOString(),
        ...meta,
    });
}

function info(message, meta = {}) {
    console.log(formatPayload('info', message, meta));
}

function warn(message, meta = {}) {
    console.warn(formatPayload('warn', message, meta));
}

function error(message, meta = {}) {
    console.error(formatPayload('error', message, meta));
}

const logger = {
    info,
    warn,
    error,
};

module.exports = {
    logger,
    info,
    warn,
    error,
};
