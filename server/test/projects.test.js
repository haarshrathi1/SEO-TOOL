const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../projects');

test('buildProjectPayload normalizes urls, domains, and crawl caps', async () => {
    const payload = await __internal.buildProjectPayload({
        id: 'New Project',
        name: 'New Project',
        url: 'example.com',
        auditMaxPages: 999,
    });

    assert.equal(payload.id, 'new-project');
    assert.equal(payload.url, 'https://example.com/');
    assert.equal(payload.domain, 'example.com');
    assert.equal(payload.auditMaxPages, 999);

    const capped = await __internal.buildProjectPayload({
        id: 'Capped Project',
        name: 'Capped Project',
        url: 'example.com',
        auditMaxPages: 5000,
    });
    assert.equal(capped.auditMaxPages, 2000);
});

test('buildProjectPayload rejects non-http and private project URLs', async () => {
    await assert.rejects(
        __internal.buildProjectPayload({
            name: 'Bad protocol',
            url: 'ftp://example.com',
        }),
        /valid public http\(s\) URL/
    );

    await assert.rejects(
        __internal.buildProjectPayload({
            name: 'Private host',
            url: 'http://localhost:3000',
        }),
        /valid public http\(s\) URL/
    );
});

test('buildProjectPayload normalizes domain hostnames from URL-like domain input', async () => {
    const payload = await __internal.buildProjectPayload({
        name: 'Domain project',
        url: 'example.com',
        domain: 'HTTPS://BLOG.Example.com/path?q=1',
    });

    assert.equal(payload.domain, 'blog.example.com');
});

test('buildListProjectsQuery limits viewers to active assigned projects', () => {
    assert.deepEqual(
        __internal.buildListProjectsQuery(
            { role: 'viewer', email: 'owner@example.com', projectIds: ['laserlift', 'fleetflow'] },
            { includeInactive: true }
        ),
        {
            isActive: true,
            $or: [
                { id: { $in: ['laserlift', 'fleetflow'] } },
                { ownerEmail: 'owner@example.com' },
            ],
        }
    );
});

test('buildGetProjectQuery scopes viewer access to assigned or owned projects', () => {
    assert.deepEqual(
        __internal.buildGetProjectQuery('secret-project', { role: 'viewer', email: 'owner@example.com', projectIds: ['laserlift'] }),
        {
            id: 'secret-project',
            $or: [
                { id: { $in: ['laserlift'] } },
                { ownerEmail: 'owner@example.com' },
            ],
        }
    );
});

test('buildGetProjectQuery allows a viewer to request an assigned project', () => {
    assert.deepEqual(
        __internal.buildGetProjectQuery('laserlift', { role: 'viewer', email: 'owner@example.com', projectIds: ['laserlift'] }),
        {
            id: 'laserlift',
            $or: [
                { id: { $in: ['laserlift'] } },
                { ownerEmail: 'owner@example.com' },
            ],
        }
    );
});

test('normalizeSearchConsoleSiteUrl accepts domain properties', async () => {
    const property = await __internal.normalizeSearchConsoleSiteUrl('sc-domain:Example.com', 'https://example.com/');
    assert.equal(property, 'sc-domain:example.com');
});

test('duplicate project id helper returns a user-facing message', () => {
    assert.equal(
        __internal.getDuplicateProjectMessage('fleetflow'),
        'Project ID "fleetflow" already exists. Use a different Project ID, or edit the existing project instead.'
    );
    assert.equal(
        __internal.isDuplicateProjectIdError({
            code: 11000,
            keyPattern: { id: 1 },
            keyValue: { id: 'fleetflow' },
            message: 'E11000 duplicate key error collection: test.projects index: id_1 dup key',
        }),
        true
    );
});
