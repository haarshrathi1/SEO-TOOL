const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../projects');

test('buildProjectPayload normalizes urls, domains, and crawl caps', () => {
    const payload = __internal.buildProjectPayload({
        id: 'New Project',
        name: 'New Project',
        url: 'example.com',
        auditMaxPages: 999,
    });

    assert.equal(payload.id, 'new-project');
    assert.equal(payload.url, 'https://example.com/');
    assert.equal(payload.domain, 'example.com');
    assert.equal(payload.auditMaxPages, 500);
});

test('buildListProjectsQuery limits viewers to active assigned projects', () => {
    assert.deepEqual(
        __internal.buildListProjectsQuery(
            { role: 'viewer', projectIds: ['laserlift', 'fleetflow'] },
            { includeInactive: true }
        ),
        {
            isActive: true,
            id: { $in: ['laserlift', 'fleetflow'] },
        }
    );
});

test('buildGetProjectQuery rejects viewer access outside assigned projects', () => {
    assert.equal(
        __internal.buildGetProjectQuery('secret-project', { role: 'viewer', projectIds: ['laserlift'] }),
        null
    );
});

test('buildGetProjectQuery allows a viewer to request an assigned project', () => {
    assert.deepEqual(
        __internal.buildGetProjectQuery('laserlift', { role: 'viewer', projectIds: ['laserlift'] }),
        { id: 'laserlift' }
    );
});
