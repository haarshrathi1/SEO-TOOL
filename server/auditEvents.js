const { AuditEvent } = require('./models');
const logger = require('./logger');

async function recordAuditEvent(input = {}) {
    try {
        if (!input.workspaceId || !input.action) {
            return null;
        }

        return await AuditEvent.create({
            workspaceId: String(input.workspaceId),
            userId: input.userId ? String(input.userId) : null,
            action: String(input.action),
            entityType: input.entityType ? String(input.entityType) : '',
            entityId: input.entityId ? String(input.entityId) : '',
            metadata: input.metadata && typeof input.metadata === 'object' ? input.metadata : {},
            createdAt: new Date(),
        });
    } catch (error) {
        logger.warn('Failed to record audit event', { error: error.message, action: input.action || '' });
        return null;
    }
}

module.exports = {
    recordAuditEvent,
};
