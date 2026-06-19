const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.CLIENT_ID = process.env.CLIENT_ID || 'test-client';
process.env.DEV_ADMIN_BYPASS = process.env.DEV_ADMIN_BYPASS || 'true';

const { requireAccess, requireCsrf, __internal } = require('../userAuth');

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

test('requireCsrf skips safe methods so reads work without the header', () => {
    const req = { method: 'GET', session: null, get: () => '', body: {} };
    const res = createResponse();
    let nextCalled = false;

    requireCsrf(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.statusCode, 200);
});

test('requireCsrf rejects mutating requests with a missing or wrong token', () => {
    const reqMissing = { method: 'POST', session: { csrfToken: 'expected-token' }, get: () => '', body: {} };
    const resMissing = createResponse();
    requireCsrf(reqMissing, resMissing, () => assert.fail('next should not be called'));
    assert.equal(resMissing.statusCode, 403);

    const reqWrong = { method: 'DELETE', session: { csrfToken: 'expected-token' }, get: () => 'other-token!!', body: {} };
    const resWrong = createResponse();
    requireCsrf(reqWrong, resWrong, () => assert.fail('next should not be called'));
    assert.equal(resWrong.statusCode, 403);
});

test('requireCsrf accepts mutating requests with the correct token', () => {
    const req = { method: 'POST', session: { csrfToken: 'expected-token' }, get: () => 'expected-token', body: {} };
    const res = createResponse();
    let nextCalled = false;

    requireCsrf(req, res, () => {
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

test('self-service registration defaults include dashboard and audit access', () => {
    assert.deepEqual(
        __internal.normalizeAccess(__internal.DEFAULT_SELF_SERVICE_ACCESS),
        ['keywords', 'dashboard', 'audit'],
    );
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
