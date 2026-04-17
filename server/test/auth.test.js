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
