const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../psi');

test('buildPsiEndpoint includes url, strategy, and categories', () => {
    const endpoint = __internal.buildPsiEndpoint('https://example.com/', 'mobile', ['PERFORMANCE', 'SEO']);
    assert.ok(endpoint.startsWith('https://www.googleapis.com/pagespeedonline/v5/runPagespeed?'));
    assert.ok(endpoint.includes('url=https%3A%2F%2Fexample.com%2F'));
    assert.ok(endpoint.includes('strategy=mobile'));
    assert.ok(endpoint.includes('category=PERFORMANCE'));
    assert.ok(endpoint.includes('category=SEO'));
});

test('isRetriablePsiError returns true for transient PSI failures', () => {
    assert.equal(__internal.isRetriablePsiError({ response: { status: 500 } }), true);
    assert.equal(__internal.isRetriablePsiError({ response: { status: 429 } }), true);
    assert.equal(__internal.isRetriablePsiError({ message: 'socket hang up' }), true);
});

test('isRetriablePsiError returns false for permanent client failures', () => {
    assert.equal(__internal.isRetriablePsiError({ response: { status: 400 } }), false);
    assert.equal(__internal.isRetriablePsiError({ message: 'Request failed with status code 400' }), false);
});

test('getErrorMessage prefers provider payload message', () => {
    const message = __internal.getErrorMessage({
        response: {
            data: {
                error: {
                    message: 'Quota exceeded',
                },
            },
        },
        message: 'Request failed',
    });

    assert.equal(message, 'Quota exceeded');
});
