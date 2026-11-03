import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GEMINI_CONFIG,
    callGeminiDirect,
    geminiTestHooks
} from '../src/services/localGeminiService.js';

const noopDelay = () => {};

function okResponse(body) {
    return {
        ok: true,
        status: 200,
        json: async () => body
    };
}

function errorResponse(status, googleError) {
    return {
        ok: false,
        status,
        json: async () => ({ error: googleError })
    };
}

function jsonRequest(call) {
    return {
        url: call.args[0],
        method: call.args[1].method,
        body: JSON.parse(call.args[1].body),
        headers: call.args[1].headers
    };
}

test('callGeminiDirect throws a clear error when no keys are configured', async () => {
    await assert.rejects(
        callGeminiDirect({}, { keys: [], delayFn: noopDelay }),
        /No Gemini API key configured/
    );
});

test('callGeminiDirect sends the key via x-goog-api-key header and never in the URL', async () => {
    const calls = [];
    const payload = { contents: [{ role: 'user', parts: [{ text: 'hi' }] }] };
    geminiTestHooks.setActiveKeyIndex(0);

    const result = await callGeminiDirect(payload, {
        keys: ['test-key-primary'],
        delayFn: noopDelay,
        fetchImpl: async (...args) => {
            calls.push({ args });
            return okResponse({ candidates: [{ ok: true }] });
        }
    });

    const request = jsonRequest(calls[0]);
    assert.equal(request.url, `${GEMINI_CONFIG.apiBase}/models/${GEMINI_CONFIG.model}:generateContent`);
    assert.ok(!request.url.includes('key='), 'API key must never be placed in the URL');
    assert.equal(request.headers['x-goog-api-key'], 'test-key-primary');
    assert.equal(request.method, 'POST');
    assert.deepEqual(request.body, payload);
    assert.deepEqual(result, { candidates: [{ ok: true }] });
});

test('permanent 400 invalid-key error surfaces Google message without retry or rotation', async () => {
    const urls = [];
    const keys = ['stale-key', 'fresh-key'];
    geminiTestHooks.setActiveKeyIndex(0);
    let sawSecondKey = false;

    await assert.rejects(
        callGeminiDirect({}, {
            keys,
            delayFn: noopDelay,
            fetchImpl: async (url, init) => {
                urls.push(url);
                if (init.headers['x-goog-api-key'] === 'fresh-key') sawSecondKey = true;
                return errorResponse(400, {
                    code: 400,
                    message: 'API key not valid. Please pass a valid API key.',
                    status: 'INVALID_ARGUMENT'
                });
            }
        }),
        (error) => {
            assert.match(error.message, /HTTP 400/);
            assert.match(error.message, /INVALID_ARGUMENT/);
            assert.match(error.message, /API key not valid/);
            return true;
        }
    );

    assert.equal(urls.length, 1, 'permanent errors must not be retried');
    assert.equal(sawSecondKey, false, 'permanent errors must not rotate keys');
    assert.ok(!urls[0].includes('stale-key'), 'API key must never appear in the URL');
});

test('401 unauthorized is treated as permanent', async () => {
    let fetchCount = 0;
    geminiTestHooks.setActiveKeyIndex(0);

    await assert.rejects(
        callGeminiDirect({}, {
            keys: ['k1'],
            delayFn: noopDelay,
            fetchImpl: async () => {
                fetchCount += 1;
                return errorResponse(401, {
                    message: 'Request had invalid authentication credentials.',
                    status: 'UNAUTHENTICATED'
                });
            }
        }),
        /UNAUTHENTICATED/
    );

    assert.equal(fetchCount, 1);
});

test('403 permission denied is treated as permanent', async () => {
    let fetchCount = 0;
    geminiTestHooks.setActiveKeyIndex(0);

    await assert.rejects(
        callGeminiDirect({}, {
            keys: ['k1'],
            delayFn: noopDelay,
            fetchImpl: async () => {
                fetchCount += 1;
                return errorResponse(403, {
                    message: 'Caller does not have permission. Access to this API is denied.',
                    status: 'PERMISSION_DENIED'
                });
            }
        }),
        /PERMISSION_DENIED/
    );

    assert.equal(fetchCount, 1);
});

test('404 on the primary model falls back to the configured fallback model', async () => {
    const urls = [];
    geminiTestHooks.setActiveKeyIndex(0);

    const fallbackModel = GEMINI_CONFIG.fallbackModels[0];
    await callGeminiDirect({}, {
        keys: ['k1'],
        delayFn: noopDelay,
        fetchImpl: async (url) => {
            urls.push(url);
            if (url.includes(GEMINI_CONFIG.model)) {
                return errorResponse(404, {
                    code: 404,
                    message: `models/${GEMINI_CONFIG.model} is not found for API version v1beta.`,
                    status: 'NOT_FOUND'
                });
            }
            return okResponse({ via: fallbackModel });
        }
    });

    assert.equal(urls.length, 2);
    assert.ok(urls[0].includes(GEMINI_CONFIG.model));
    assert.ok(urls[1].includes(fallbackModel));
});

test('all models returning 404 produces a clear model-availability error', async () => {
    geminiTestHooks.setActiveKeyIndex(0);

    await assert.rejects(
        callGeminiDirect({}, {
            keys: ['k1'],
            delayFn: noopDelay,
            fetchImpl: async () => errorResponse(404, {
                message: 'not found',
                status: 'NOT_FOUND'
            })
        }),
        /No Gemini model from the configured list/
    );
});

test('429 rotates to the next key and retries until success', async () => {
    const keySequence = [];
    geminiTestHooks.setActiveKeyIndex(0);

    const result = await callGeminiDirect({}, {
        keys: ['k1', 'k2'],
        delayFn: noopDelay,
        maxRetries: 3,
        fetchImpl: async (url, init) => {
            keySequence.push(init.headers['x-goog-api-key']);
            return keySequence.length === 1
                ? errorResponse(429, { message: 'Resource has been exhausted.', status: 'RESOURCE_EXHAUSTED' })
                : okResponse({ ok: 1 });
        }
    });

    assert.deepEqual(result, { ok: 1 });
    assert.deepEqual(keySequence, ['k1', 'k2']);
});

test('rate-limit error message is sanitized and never contains key material', async () => {
    geminiTestHooks.setActiveKeyIndex(0);

    await assert.rejects(
        callGeminiDirect({}, {
            keys: ['k1'],
            delayFn: noopDelay,
            maxRetries: 0,
            fetchImpl: async () => errorResponse(429, {
                message: 'Quota exhausted for key AIzaSySecretToken12345678',
                status: 'RESOURCE_EXHAUSTED'
            })
        }),
        (error) => {
            assert.match(error.message, /after 1 attempts/);
            assert.match(error.message, /\[redacted\]/);
            assert.ok(!error.message.includes('AIzaSySecretToken12345678'));
            return true;
        }
    );
});

test('5xx errors retry with bounded exponential backoff before failing', async () => {
    const delays = [];
    let fetchCount = 0;
    geminiTestHooks.setActiveKeyIndex(0);

    await assert.rejects(
        callGeminiDirect({}, {
            keys: ['k1'],
            maxRetries: 2,
            delayFn: (ms) => {
                delays.push(ms);
                return noopDelay();
            },
            fetchImpl: async () => {
                fetchCount += 1;
                return errorResponse(500, {
                    message: 'Internal error encountered.',
                    status: 'INTERNAL'
                });
            }
        }),
        (error) => {
            assert.match(error.message, /after 3 attempts/);
            assert.match(error.message, /Internal error encountered/);
            return true;
        }
    );

    assert.equal(fetchCount, 3);
    assert.deepEqual(delays, [1000, 2000], 'bounded exponential backoff must be used');
});

test('network failures retry the same request and surface a network error', async () => {
    let fetchCount = 0;
    geminiTestHooks.setActiveKeyIndex(0);

    await assert.rejects(
        callGeminiDirect({}, {
            keys: ['k1'],
            maxRetries: 2,
            delayFn: noopDelay,
            fetchImpl: async () => {
                fetchCount += 1;
                throw new TypeError('failed to fetch');
            }
        }),
        /network error/i
    );

    assert.equal(fetchCount, 3, 'network errors must retry, not rotate keys');
});

test('GeminiSettingsModal key storage still round-trips via localStorage-compatible API', async () => {
    const calls = [];
    geminiTestHooks.setActiveKeyIndex(0);

    await callGeminiDirect({}, {
        keys: ['k1'],
        delayFn: noopDelay,
        fetchImpl: async (url, init) => {
            calls.push({ url, init });
            return okResponse({});
        }
    });

    assert.equal(calls[0].init.headers['x-goog-api-key'], 'k1');
    assert.ok(!calls[0].url.includes('k1'), 'key must not leak through the URL');
});
