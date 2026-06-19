const test = require('node:test');
const assert = require('node:assert/strict');

const { __internal } = require('../db');

test('isRetriableMongoError treats DNS lookup failures as retriable', () => {
    const error = new Error('getaddrinfo ENOTFOUND ac-zgspw61-shard-00-02.xvobgjx.mongodb.net');
    error.name = 'MongoNetworkError';
    error.cause = { code: 'ENOTFOUND' };

    assert.equal(__internal.isRetriableMongoError(error), true);
});

test('isRetriableMongoError does not retry permanent config errors', () => {
    const error = new Error('MONGODB_URI is missing. Add it to server/.env');

    assert.equal(__internal.isRetriableMongoError(error), false);
});
