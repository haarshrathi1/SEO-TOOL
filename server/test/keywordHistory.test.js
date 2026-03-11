const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../keywordHistory');

test('buildHistoryQuery scopes viewer history to the signed-in owner', () => {
    assert.deepEqual(
        __internal.buildHistoryQuery(
            { role: 'viewer', email: 'viewer@example.com' },
            { projectId: 'laserlift' }
        ),
        { ownerEmail: 'viewer@example.com', projectId: 'laserlift' }
    );
});

test('buildHistoryQuery lets admins see their own records and legacy unowned entries', () => {
    assert.deepEqual(
        __internal.buildHistoryQuery({ role: 'admin', email: 'admin@example.com' }),
        {
            $or: [
                { ownerEmail: 'admin@example.com' },
                { ownerEmail: { $exists: false } },
            ],
        }
    );
});

test('buildHistoryQuery lets admins scope project history across all owners', () => {
    assert.deepEqual(
        __internal.buildHistoryQuery(
            { role: 'admin', email: 'admin@example.com' },
            { projectId: 'laserlift' }
        ),
        { projectId: 'laserlift' }
    );
});

test('normalizeProjectId trims empty values to null', () => {
    assert.equal(__internal.normalizeProjectId('  '), null);
    assert.equal(__internal.normalizeProjectId(' fleetflow '), 'fleetflow');
});
