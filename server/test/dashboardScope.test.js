const test = require('node:test');
const assert = require('node:assert/strict');

const history = require('../history');
const auditHistory = require('../auditHistory');
const auditJobs = require('../auditJobs');

test('dashboard history query limits viewers to their assigned projects', () => {
    assert.deepEqual(
        history.__internal.buildHistoryQuery(
            { role: 'viewer', projectIds: ['fleetflow', 'laserlift'] },
            {}
        ),
        { projectId: { $in: ['fleetflow', 'laserlift'] } }
    );

    assert.equal(
        history.__internal.buildHistoryQuery(
            { role: 'viewer', projectIds: ['fleetflow'] },
            { projectId: 'laserlift' }
        ),
        null
    );
});

test('audit history query respects explicit viewer project scope', () => {
    assert.deepEqual(
        auditHistory.__internal.buildAuditHistoryQuery(
            { role: 'viewer', projectIds: ['fleetflow'] },
            { projectId: 'fleetflow' }
        ),
        { projectId: 'fleetflow' }
    );
});

test('audit jobs list query limits viewers to assigned projects', () => {
    assert.deepEqual(
        auditJobs.__internal.buildAuditJobListQuery(
            { role: 'viewer', projectIds: ['fleetflow'] },
            {}
        ),
        { projectId: { $in: ['fleetflow'] } }
    );
});

test('audit job access is granted by project scope for viewers', () => {
    assert.equal(
        auditJobs.__internal.canAccessAuditJob(
            { id: 'job-1', projectId: 'fleetflow' },
            { role: 'viewer', projectIds: ['fleetflow'] }
        ),
        true
    );

    assert.equal(
        auditJobs.__internal.canAccessAuditJob(
            { id: 'job-2', projectId: 'laserlift' },
            { role: 'viewer', projectIds: ['fleetflow'] }
        ),
        false
    );
});
