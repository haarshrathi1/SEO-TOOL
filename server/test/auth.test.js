const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.CLIENT_ID = process.env.CLIENT_ID || 'test-client';
process.env.CLIENT_SECRET = process.env.CLIENT_SECRET || 'test-secret';
process.env.REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3001/auth/google/callback';

const { __internal } = require('../auth');

test('resolveProjectAuthSource requires explicit self-serve Google connections', () => {
    assert.deepEqual(
        __internal.resolveProjectAuthSource({
            ownerEmail: 'viewer@example.com',
            googleConnectionEmail: 'viewer@example.com',
        }),
        {
            connectionEmail: 'viewer@example.com',
            allowSharedFallback: false,
        }
    );
});

test('resolveProjectAuthSource keeps shared fallback for legacy owner-only projects', () => {
    assert.deepEqual(
        __internal.resolveProjectAuthSource({
            ownerEmail: 'admin@example.com',
            googleConnectionEmail: '',
        }),
        {
            connectionEmail: 'admin@example.com',
            allowSharedFallback: true,
        }
    );
});

test('resolveProjectAuthSource falls back to shared auth when no project user context exists', () => {
    assert.deepEqual(
        __internal.resolveProjectAuthSource({}),
        {
            connectionEmail: '',
            allowSharedFallback: true,
        }
    );
});
