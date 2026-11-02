const DEFAULT_MODEL = 'gemini-2.5-flash';
const DEFAULT_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_ENV_NAMES = [
    'GEMINI_API_KEY_1',
    'GEMINI_API_KEY_2',
    'GEMINI_API_KEY_3',
    'GEMINI_API_KEY_4',
    'GEMINI_API_KEY_5'
];
const ROTATE_STATUSES = new Set([401, 403, 429, 500, 502, 503, 504]);

class AiServiceError extends Error {
    constructor(message, options = {}) {
        super(message);
        this.name = 'AiServiceError';
        this.code = options.code || 'AI_UNAVAILABLE';
        this.statusCode = options.statusCode || 503;
        this.upstreamStatus = options.upstreamStatus || null;
        this.cause = options.cause;
    }
}

function readApiKeys(env = process.env) {
    return KEY_ENV_NAMES
        .map(name => String(env[name] || '').trim())
        .filter(key => key && key !== 'YOUR_EXTRA_KEY_HERE' && !key.startsWith('YOUR_'));
}

function validateGeneratePayload(payload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        throw new AiServiceError('Invalid AI request payload.', {
            code: 'AI_INVALID_REQUEST',
            statusCode: 400
        });
    }

    if (!Array.isArray(payload.contents) || payload.contents.length === 0) {
        throw new AiServiceError('AI request must include at least one content entry.', {
            code: 'AI_INVALID_REQUEST',
            statusCode: 400
        });
    }

    if (payload.contents.length > 40) {
        throw new AiServiceError('AI request contains too many content entries.', {
            code: 'AI_INVALID_REQUEST',
            statusCode: 400
        });
    }

    if (payload.contents.some(entry => !entry || typeof entry !== 'object' || Array.isArray(entry))) {
        throw new AiServiceError('AI request content entries must be objects.', {
            code: 'AI_INVALID_REQUEST',
            statusCode: 400
        });
    }

    return payload;
}

function truncate(value, maxLength = 300) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

async function readResponseText(response) {
    try {
        return await response.text();
    } catch {
        return '';
    }
}

function createGeminiService(options = {}) {
    const apiKeys = (options.apiKeys || readApiKeys()).map(key => String(key).trim()).filter(Boolean);
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    const endpoint = (options.endpoint || process.env.GEMINI_ENDPOINT || DEFAULT_ENDPOINT).replace(/\/+$/, '');
    const model = options.model || process.env.GEMINI_MODEL || DEFAULT_MODEL;
    const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 4;
    const timeoutMs = Number(options.timeoutMs) || Number(process.env.AI_REQUEST_TIMEOUT_MS) || 60000;
    const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));

    let currentKeyIndex = 0;

    if (typeof fetchImpl !== 'function') {
        throw new Error('A fetch implementation is required by the AI service.');
    }

    function rotateKey() {
        if (apiKeys.length <= 1) return false;
        currentKeyIndex = (currentKeyIndex + 1) % apiKeys.length;
        console.log(`[AI SERVICE] Rotating to key #${currentKeyIndex + 1}`);
        return true;
    }

    async function waitBeforeRetry(attempt) {
        const base = apiKeys.length > 1 ? 250 : 1000;
        const waitMs = Math.min(base * (2 ** attempt), 8000) + Math.floor(Math.random() * 250);
        await sleep(waitMs);
    }

    async function request(payload) {
        validateGeneratePayload(payload);

        if (apiKeys.length === 0) {
            throw new AiServiceError('AI service is not configured on the server.', {
                code: 'AI_NOT_CONFIGURED',
                statusCode: 503
            });
        }

        let lastError = null;

        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const keyIndex = currentKeyIndex % apiKeys.length;
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetchImpl(
                    `${endpoint}/models/${model}:generateContent?key=${apiKeys[keyIndex]}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: controller.signal
                    }
                );

                if (ROTATE_STATUSES.has(response.status)) {
                    lastError = new AiServiceError('AI service is temporarily unavailable.', {
                        code: response.status === 401 || response.status === 403
                            ? 'AI_AUTH_FAILED'
                            : 'AI_UNAVAILABLE',
                        statusCode: 503,
                        upstreamStatus: response.status
                    });

                    if (response.status === 401 || response.status === 403) {
                        console.error(`[AI SERVICE] Key #${keyIndex + 1} was rejected by Gemini (${response.status}).`);
                    } else {
                        console.warn(`[AI SERVICE] Key #${keyIndex + 1} returned ${response.status}. Rotating...`);
                    }

                    rotateKey();
                    if (attempt < maxRetries) await waitBeforeRetry(attempt);
                    continue;
                }

                if (!response.ok) {
                    const errorText = truncate(await readResponseText(response));
                    console.error(`[AI SERVICE] Gemini rejected the request with ${response.status}: ${errorText}`);
                    throw new AiServiceError('AI service rejected the request.', {
                        code: 'AI_UPSTREAM_ERROR',
                        statusCode: 502,
                        upstreamStatus: response.status
                    });
                }

                return await response.json();
            } catch (error) {
                if (error instanceof AiServiceError && error.code === 'AI_UPSTREAM_ERROR') {
                    throw error;
                }

                lastError = error.name === 'AbortError'
                    ? new AiServiceError('AI service timed out.', {
                        code: 'AI_TIMEOUT',
                        statusCode: 503
                    })
                    : error;

                console.error(
                    `[AI SERVICE] Request failed with key #${keyIndex + 1} (attempt ${attempt + 1}):`,
                    lastError?.message || 'Unknown error'
                );

                rotateKey();
                if (attempt < maxRetries) await waitBeforeRetry(attempt);
            } finally {
                clearTimeout(timeout);
            }
        }

        throw new AiServiceError(
            'AI service is temporarily unavailable. Please try again in a moment.',
            {
                code: 'AI_UNAVAILABLE',
                statusCode: 503,
                cause: lastError
            }
        );
    }

    return {
        request,
        getKeyCount: () => apiKeys.length,
        getCurrentKeyIndex: () => currentKeyIndex,
        getModel: () => model
    };
}

const defaultService = createGeminiService();

module.exports = {
    AiServiceError,
    DEFAULT_MODEL,
    KEY_ENV_NAMES,
    createGeminiService,
    defaultService,
    readApiKeys,
    validateGeneratePayload
};
