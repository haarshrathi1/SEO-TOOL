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
            googleConnectionId: '507f1f77bcf86cd799439011',
        }),
        {
            googleConnectionId: '507f1f77bcf86cd799439011',
            allowSharedFallback: false,
        }
    );
});

test('resolveProjectAuthSource refuses shared fallback for projects without an explicit connection', () => {
    assert.deepEqual(
        __internal.resolveProjectAuthSource({
            ownerEmail: 'admin@example.com',
            googleConnectionEmail: '',
        }),
        {
            googleConnectionId: '',
            allowSharedFallback: false,
        }
    );
});

test('resolveProjectAuthSource stays closed when no project connection exists', () => {
    assert.deepEqual(
        __internal.resolveProjectAuthSource({}),
        {
            googleConnectionId: '',
            allowSharedFallback: false,
        }
    );
});

test('admin OAuth state round-trips through sign and verify', () => {
    const state = __internal.buildAdminOauthState('google-oauth', { email: 'Admin@Example.com' });
    assert.deepEqual(__internal.parseAdminOauthState(state), {
        provider: 'google-oauth',
        email: 'admin@example.com',
    });
});

test('parseAdminOauthState rejects legacy fixed-string and forged states', () => {
    assert.equal(__internal.parseAdminOauthState('google-oauth'), null);
    assert.equal(__internal.parseAdminOauthState('google-ads-oauth'), null);
    assert.equal(__internal.parseAdminOauthState('google-all-oauth'), null);
    assert.equal(__internal.parseAdminOauthState(''), null);
    assert.equal(__internal.parseAdminOauthState('not-a-jwt'), null);
    // A user-connection state must not be accepted as an admin state.
    const userState = __internal.buildUserOauthState({
        userId: 'u1',
        workspaceId: 'w1',
        email: 'user@example.com',
    });
    assert.equal(__internal.parseAdminOauthState(userState), null);
});

test('parseAdminOauthState rejects unknown providers', () => {
    const jwt = require('jsonwebtoken');
    const forged = jwt.sign({
        kind: 'admin_google_connection',
        provider: 'something-else',
    }, process.env.JWT_SECRET);
    assert.equal(__internal.parseAdminOauthState(forged), null);
});

test('buildProjectRecommendationContext derives comparable keys from draft inputs', () => {
    assert.deepEqual(
        __internal.buildProjectRecommendationContext({
            name: 'FleetFlow',
            url: 'https://fleetflow.hyvikk.com/',
        }),
        {
            name: 'FleetFlow',
            url: 'https://fleetflow.hyvikk.com/',
            domain: 'fleetflow.hyvikk.com',
            gscSiteUrl: '',
            ga4PropertyId: '',
            primaryHostLabel: 'fleetflow',
            rootDomainLabel: 'hyvikk',
            nameKey: 'fleetflow',
            domainKey: 'fleetflowhyvikkcom',
            urlHostKey: 'fleetflowhyvikkcom',
            gscHostKey: '',
        }
    );
});

test('suggestSearchConsoleSite matches an unsaved draft project by URL', () => {
    const context = __internal.buildProjectRecommendationContext({
        url: 'https://hyvikk.ca/',
    });

    assert.equal(
        __internal.suggestSearchConsoleSite([
            { siteUrl: 'https://fleetflow.hyvikk.com/' },
            { siteUrl: 'https://hyvikk.ca/' },
        ], context),
        'https://hyvikk.ca/'
    );
});

test('suggestGa4Property recommends the closest property for a draft project', () => {
    const context = __internal.buildProjectRecommendationContext({
        name: 'Hyvikk CA',
        url: 'https://hyvikk.ca/',
    });

    assert.equal(
        __internal.suggestGa4Property([
            { propertyId: '518947686', displayName: 'FleetFlow SaaS', account: 'Hyvikk solutions', label: 'FleetFlow SaaS (518947686)' },
            { propertyId: '507532333', displayName: 'Hyvikk CA', account: 'Hyvikk CA', label: 'Hyvikk CA (507532333)' },
        ], context),
        '507532333'
    );
});

test('suggestGa4Property does not force a weak company-only match', () => {
    const context = __internal.buildProjectRecommendationContext({
        name: 'Blog',
        url: 'https://blog.hyvikk.com/',
    });

    assert.equal(
        __internal.suggestGa4Property([
            { propertyId: '518947686', displayName: 'FleetFlow SaaS', account: 'Hyvikk solutions', label: 'FleetFlow SaaS (518947686)' },
            { propertyId: '507532333', displayName: 'Hyvikk CA', account: 'Hyvikk CA', label: 'Hyvikk CA (507532333)' },
        ], context),
        ''
    );
});
