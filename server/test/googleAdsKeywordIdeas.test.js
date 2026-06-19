const test = require('node:test');
const assert = require('node:assert/strict');

const auth = require('../auth');
const {
    GOOGLE_ADS_PROVIDER,
    getPreferredKeywordAdsProviderConfig,
} = require('../keywordAdsProviders');
const googleAdsKeywordIdeas = require('../googleAdsKeywordIdeas');

function snapshotEnv(keys) {
    return Object.fromEntries(keys.map((key) => [key, process.env[key]]));
}

function restoreEnv(snapshot) {
    Object.entries(snapshot).forEach(([key, value]) => {
        if (value === undefined) {
            delete process.env[key];
            return;
        }

        process.env[key] = value;
    });
}

test('getGoogleAdsProviderConfig flags stored OAuth tokens without adwords scope', () => {
    const envKeys = [
        'GOOGLE_ADS_DEVELOPER_TOKEN',
        'GOOGLE_ADS_CUSTOMER_ID',
        'GOOGLE_ADS_REFRESH_TOKEN',
    ];
    const originalEnv = snapshotEnv(envKeys);
    const originalCredentials = { ...auth.oauth2Client.credentials };
    const originalGoogleAdsCredentials = { ...auth.googleAdsOauth2Client.credentials };

    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'token';
    process.env.GOOGLE_ADS_CUSTOMER_ID = '123-456-7890';
    delete process.env.GOOGLE_ADS_REFRESH_TOKEN;

    auth.googleAdsOauth2Client.setCredentials({});
    auth.oauth2Client.setCredentials({
        refresh_token: 'refresh-token',
        scope: 'https://www.googleapis.com/auth/webmasters.readonly',
    });

    const config = googleAdsKeywordIdeas.getGoogleAdsProviderConfig();

    assert.equal(config.configured, false);
    assert.equal(config.reason, 'missing_oauth_scope');
    assert.equal(config.customerId, '1234567890');

    auth.googleAdsOauth2Client.setCredentials(originalGoogleAdsCredentials);
    auth.oauth2Client.setCredentials(originalCredentials);
    restoreEnv(originalEnv);
});

test('preferred provider switches to Google Ads API when explicit credentials are present', () => {
    const envKeys = [
        'CLIENT_ID',
        'CLIENT_SECRET',
        'GOOGLE_ADS_DEVELOPER_TOKEN',
        'GOOGLE_ADS_CUSTOMER_ID',
        'GOOGLE_ADS_REFRESH_TOKEN',
    ];
    const originalEnv = snapshotEnv(envKeys);
    const originalCredentials = { ...auth.oauth2Client.credentials };
    const originalGoogleAdsCredentials = { ...auth.googleAdsOauth2Client.credentials };

    process.env.CLIENT_ID = 'client-id';
    process.env.CLIENT_SECRET = 'client-secret';
    process.env.GOOGLE_ADS_DEVELOPER_TOKEN = 'token';
    process.env.GOOGLE_ADS_CUSTOMER_ID = '1234567890';
    process.env.GOOGLE_ADS_REFRESH_TOKEN = 'refresh-token';

    auth.googleAdsOauth2Client.setCredentials({});
    auth.oauth2Client.setCredentials({});

    const provider = getPreferredKeywordAdsProviderConfig();

    assert.equal(provider.provider, GOOGLE_ADS_PROVIDER);
    assert.equal(provider.configured, true);

    auth.googleAdsOauth2Client.setCredentials(originalGoogleAdsCredentials);
    auth.oauth2Client.setCredentials(originalCredentials);
    restoreEnv(originalEnv);
});

test('preferred provider remains Google Ads API and reports not configured when Ads auth is missing', () => {
    const envKeys = [
        'GOOGLE_ADS_DEVELOPER_TOKEN',
        'GOOGLE_ADS_CUSTOMER_ID',
        'GOOGLE_ADS_REFRESH_TOKEN',
    ];
    const originalEnv = snapshotEnv(envKeys);
    const originalCredentials = { ...auth.oauth2Client.credentials };
    const originalGoogleAdsCredentials = { ...auth.googleAdsOauth2Client.credentials };

    delete process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
    delete process.env.GOOGLE_ADS_CUSTOMER_ID;
    delete process.env.GOOGLE_ADS_REFRESH_TOKEN;

    auth.oauth2Client.setCredentials({});
    auth.googleAdsOauth2Client.setCredentials({});

    const provider = getPreferredKeywordAdsProviderConfig();

    assert.equal(provider.provider, GOOGLE_ADS_PROVIDER);
    assert.equal(provider.configured, false);
    assert.equal(provider.reason, 'missing_developer_token');

    auth.oauth2Client.setCredentials(originalCredentials);
    auth.googleAdsOauth2Client.setCredentials(originalGoogleAdsCredentials);
    restoreEnv(originalEnv);
});

test('mapGoogleAdsResult normalizes Google Ads keyword idea metrics', () => {
    const mapped = googleAdsKeywordIdeas.__internal.mapGoogleAdsResult({
        text: ' CRM software ',
        keywordIdeaMetrics: {
            avgMonthlySearches: '2900',
            competition: 'HIGH',
            competitionIndex: '83',
            averageCpcMicros: '1230000',
            lowTopOfPageBidMicros: '980000',
            highTopOfPageBidMicros: '2450000',
            monthlySearchVolumes: [
                { year: '2026', month: 'JANUARY', monthlySearches: '3200' },
                { year: '2025', month: 'DECEMBER', monthlySearches: '2800' },
            ],
        },
    });

    assert.deepEqual(mapped, {
        keyword: 'crm software',
        competition: 'HIGH',
        competitionIndex: 83,
        searchVolume: 2900,
        cpc: 1.23,
        lowTopOfPageBid: 0.98,
        highTopOfPageBid: 2.45,
        monthlySearches: [
            { year: 2026, month: 1, searchVolume: 3200 },
            { year: 2025, month: 12, searchVolume: 2800 },
        ],
    });
});

test('extractGoogleAdsErrorMessage surfaces OAuth refresh failures clearly', () => {
    const message = googleAdsKeywordIdeas.__internal.extractGoogleAdsErrorMessage({
        response: {
            data: {
                error: 'invalid_grant',
                error_description: 'Bad Request',
            },
        },
    });

    assert.equal(message, 'invalid_grant: Bad Request');
});

test('extractGoogleAdsErrorMessage surfaces structured Google Ads API failures clearly', () => {
    const message = googleAdsKeywordIdeas.__internal.extractGoogleAdsErrorMessage({
        response: {
            data: {
                error: {
                    code: 403,
                    message: 'Google Ads API has not been used in this project before or it is disabled.',
                    status: 'PERMISSION_DENIED',
                },
            },
        },
    });

    assert.equal(message, 'Google Ads API has not been used in this project before or it is disabled.');
});
