const test = require('node:test');
const assert = require('node:assert/strict');

const {
    AiServiceError,
    createGeminiService,
    readApiKeys,
    validateGeneratePayload
} = require('../services/aiService');

const validPayload = {
    contents: [{ role: 'user', parts: [{ text: 'Hello' }] }]
};

function response(status, body = {}) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
        text: async () => JSON.stringify(body)
    };
}

test('validateGeneratePayload rejects empty and malformed requests', () => {
    assert.throws(
        () => validateGeneratePayload({ contents: [] }),
        error => error instanceof AiServiceError && error.code === 'AI_INVALID_REQUEST'
    );

    assert.throws(
        () => validateGeneratePayload({ contents: ['not-an-object'] }),
        error => error instanceof AiServiceError && error.code === 'AI_INVALID_REQUEST'
    );
});

test('readApiKeys ignores empty and placeholder values', () => {
    const keys = readApiKeys({
        GEMINI_API_KEY_1: 'key-one',
        GEMINI_API_KEY_2: '',
        GEMINI_API_KEY_3: 'YOUR_EXTRA_KEY_HERE',
        GEMINI_API_KEY_4: 'YOUR_KEY_HERE',
        GEMINI_API_KEY_5: ' key-five '
    });

    assert.deepEqual(keys, ['key-one', 'key-five']);
});

test('rotates to the next key after a rate limit response', async () => {
    const requestedUrls = [];
    const service = createGeminiService({
        apiKeys: ['key-one', 'key-two'],
        sleep: async () => {},
        fetchImpl: async url => {
            requestedUrls.push(url);
            if (requestedUrls.length === 1) return response(429);
            return response(200, {
                candidates: [{ content: { parts: [{ text: 'ok' }] } }]
            });
        }
    });

    const result = await service.request(validPayload);

    assert.equal(result.candidates[0].content.parts[0].text, 'ok');
    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[0], /key-one/);
    assert.match(requestedUrls[1], /key-two/);
});

test('rotates away from a rejected key', async () => {
    const requestedUrls = [];
    const service = createGeminiService({
        apiKeys: ['bad-key', 'good-key'],
        sleep: async () => {},
        fetchImpl: async url => {
            requestedUrls.push(url);
            if (requestedUrls.length === 1) return response(403, { error: 'denied' });
            return response(200, { candidates: [] });
        }
    });

    await service.request(validPayload);

    assert.equal(requestedUrls.length, 2);
    assert.match(requestedUrls[1], /good-key/);
});

test('returns a sanitized error when every attempt fails', async () => {
    const service = createGeminiService({
        apiKeys: ['secret-key-one', 'secret-key-two'],
        maxRetries: 1,
        sleep: async () => {},
        fetchImpl: async () => response(429, { error: 'quota exceeded' })
    });

    await assert.rejects(
        () => service.request(validPayload),
        error => {
            assert.ok(error instanceof AiServiceError);
            assert.equal(error.code, 'AI_UNAVAILABLE');
            assert.equal(error.statusCode, 503);
            assert.doesNotMatch(error.message, /secret-key/);
            return true;
        }
    );
});

test('does not call Gemini when no keys are configured', async () => {
    let called = false;
    const service = createGeminiService({
        apiKeys: [],
        fetchImpl: async () => {
            called = true;
            return response(200);
        }
    });

    await assert.rejects(
        () => service.request(validPayload),
        error => error instanceof AiServiceError && error.code === 'AI_NOT_CONFIGURED'
    );
    assert.equal(called, false);
});

test('does not rotate on an invalid client request', async () => {
    let calls = 0;
    const service = createGeminiService({
        apiKeys: ['key-one', 'key-two'],
        sleep: async () => {},
        fetchImpl: async () => {
            calls += 1;
            return response(400, { error: 'bad request' });
        }
    });

    await assert.rejects(
        () => service.request(validPayload),
        error => error instanceof AiServiceError && error.code === 'AI_UPSTREAM_ERROR'
    );
    assert.equal(calls, 1);
});
