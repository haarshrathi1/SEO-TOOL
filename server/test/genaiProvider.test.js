const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../genaiProvider');

test('getSuggestedRetryDelayMs parses RetryInfo from Gemini 429 messages', () => {
    assert.equal(__internal.getSuggestedRetryDelayMs({ message: 'Quota exceeded ... "retryDelay":"22s" ...' }), 22000);
    assert.equal(__internal.getSuggestedRetryDelayMs({ message: 'Please retry in 7.5s' }), 7500);
    assert.equal(__internal.getSuggestedRetryDelayMs({ message: 'internal error' }), 0);
});

test('getRetryDelayMs enforces a 10s floor on rate limits and honors suggested delays', () => {
    const rateLimited = { message: 'rate limit', status: 429 };
    assert.ok(__internal.getRetryDelayMs(1, rateLimited) >= 10000);

    const suggested = { message: '"retryDelay":"45s"', status: 429 };
    assert.ok(__internal.getRetryDelayMs(1, suggested) >= 45000);

    const capped = { message: '"retryDelay":"999s"', status: 429 };
    assert.equal(__internal.getRetryDelayMs(1, capped), 120000);

    const plain = { message: 'socket hang up' };
    assert.ok(__internal.getRetryDelayMs(1, plain) < 10000);
});

test('isDailyQuotaError detects exhausted daily quotas so retries are skipped', () => {
    assert.equal(__internal.isDailyQuotaError({
        status: 429,
        message: 'Quota exceeded ... GenerateRequestsPerDayPerProjectPerModel-FreeTier ...',
    }), true);
    assert.equal(__internal.isDailyQuotaError({
        status: 429,
        message: 'Rate limit: requests per minute exceeded',
    }), false);
    assert.equal(__internal.isDailyQuotaError({ status: 500, message: 'daily backend error' }), false);
});

test('isRetriableError flags 429 and transient network failures', () => {
    assert.equal(__internal.isRetriableError({ status: 429 }), true);
    assert.equal(__internal.isRetriableError({ message: 'ECONNRESET' }), true);
    assert.equal(__internal.isRetriableError({ status: 400, message: 'invalid argument' }), false);
});
