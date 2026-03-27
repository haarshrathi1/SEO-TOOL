const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.CLIENT_ID = process.env.CLIENT_ID || 'test-client';
process.env.DEV_ADMIN_BYPASS = process.env.DEV_ADMIN_BYPASS || 'true';

const { requireAccess, __internal } = require('../userAuth');

function createResponse() {
    return {
        statusCode: 200,
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        },
    };
}

test('getRequiredJwtSecret throws when JWT secret is missing', () => {
    assert.throws(
        () => __internal.getRequiredJwtSecret({}),
        /JWT_SECRET is required/
    );
});

test('requireAccess allows a viewer with matching access and project scope', () => {
    const middleware = requireAccess('keywords');
    const req = {
        user: {
            role: 'viewer',
            access: ['keywords'],
            projectIds: ['laserlift'],
        },
        body: { projectId: 'laserlift' },
        query: {},
        params: {},
    };
    const res = createResponse();
    let nextCalled = false;

    middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
});

test('requireAccess rejects a viewer without the requested surface permission', () => {
    const middleware = requireAccess('dashboard');
    const req = {
        user: {
            role: 'viewer',
            access: ['keywords'],
            projectIds: ['laserlift'],
        },
        body: {},
        query: {},
        params: {},
    };
    const res = createResponse();
    let nextCalled = false;

    middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'dashboard access required' });
});

test('requireAccess rejects a viewer outside the requested project scope', () => {
    const middleware = requireAccess('keywords');
    const req = {
        user: {
            role: 'viewer',
            access: ['keywords'],
            projectIds: ['fleetflow'],
        },
        body: { projectId: 'laserlift' },
        query: {},
        params: {},
    };
    const res = createResponse();
    let nextCalled = false;

    middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.deepEqual(res.body, { error: 'Project access required' });
});

test('requireAccess always allows admins through', () => {
    const middleware = requireAccess('audit');
    const req = {
        user: {
            role: 'admin',
            access: [],
            projectIds: [],
        },
        body: { projectId: 'blocked-project' },
        query: {},
        params: {},
    };
    const res = createResponse();
    let nextCalled = false;

    middleware(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
});

test('normalizeFeatures only keeps supported premium flags', () => {
    assert.deepEqual(
        __internal.normalizeFeatures(['keyword_ads', 'keyword_ads', 'unknown']),
        ['keyword_ads'],
    );
    assert.deepEqual(__internal.normalizeFeatures(null), []);
});


test('resolveLoginRole keeps real viewers as viewers even with local dev bypass', () => {
    assert.equal(
        __internal.resolveLoginRole({
            adminAllowed: false,
            viewerExists: true,
            allowDevAdmin: true,
        }),
        'viewer',
    );
});

test('resolveFreshRole downgrades a bypassed admin token to viewer when a viewer record exists', () => {
    assert.equal(
        __internal.resolveFreshRole({
            tokenRole: 'admin',
            adminAllowed: false,
            viewerExists: true,
            allowDevAdmin: true,
        }),
        'viewer',
    );
});

test('resolveFreshRole still allows local admin bypass when no viewer record exists', () => {
    assert.equal(
        __internal.resolveFreshRole({
            tokenRole: 'admin',
            adminAllowed: false,
            viewerExists: false,
            allowDevAdmin: true,
        }),
        'admin',
    );
});
