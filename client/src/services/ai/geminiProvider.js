import { loadGeminiKeys } from '../geminiKeys.js';
import { logAiEvent } from '../aiLogger.js';

/**
 * Google Gemini transport.
 *
 * All Gemini-specific request logic lives here. Financial calculations,
 * prompts and caching remain in the local AI facade so this file only deals
 * with talking to Google.
 */

export const GEMINI_CONFIG = {
    apiBase: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-flash-latest',
    fallbackModels: [
        'gemini-3.8-flash',
        'gemini-2.5-flash',
        'gemini-2.0-flash'
    ]
};

const RETRYABLE_HTTP_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES_PER_MODEL = 1;
const MAX_BACKOFF_MS = 8000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;
const DEFAULT_TOTAL_TIMEOUT_MS = 90000;
const MODEL_CACHE_TTL_MS = 10 * 60 * 1000;
const VISION_MODEL_PATTERN = /gemini.*(?:flash|pro|vision)/i;
const NON_VISION_MODEL_PATTERN = /embedding|imagen|veo|aqa/i;

let activeKeyIndex = 0;
let modelCache = null;

// Test-only hook so simulated tests can pin the rotation start index.
export const geminiTestHooks = {
    setActiveKeyIndex(value) {
        activeKeyIndex = Math.max(0, Number(value) || 0);
    }
};

export function parseJsonSafely(text, fallback) {
    if (typeof text !== 'string' || !text.trim()) return fallback;
    try {
        return JSON.parse(text);
    } catch {
        try {
            const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
            return JSON.parse(cleaned);
        } catch {
            return fallback;
        }
    }
}

/**
 * Strips anything that could expose an API key or authorization value from a
 * provider message before it is logged or shown to the user.
 */
export function sanitizeGeminiErrorMessage(message) {
    return String(message || '')
        .replace(/AIza[0-9A-Za-z_.-]+/g, '[redacted]')
        .replace(/key_[A-Za-z0-9._-]+/g, '[redacted]')
        .replace(/sk-[A-Za-z0-9._-]+/g, '[redacted]')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
}

function failWithLog(message, detail = {}) {
    logAiEvent('gemini.failure', {
        ...detail,
        error: sanitizeGeminiErrorMessage(message)
    });
    return new Error(message);
}

function backoffDelayMs(attempt, random = Math.random) {
    const base = Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
    const jitter = 0.5 + (random() * 0.5);
    return Math.round(base * jitter);
}

export function isVisionCapableModel(model) {
    const name = String(model || '').trim();
    return Boolean(name)
        && VISION_MODEL_PATTERN.test(name)
        && !NON_VISION_MODEL_PATTERN.test(name);
}

function payloadRequiresVision(payload) {
    const contents = Array.isArray(payload?.contents) ? payload.contents : [];
    return contents.some(content =>
        (Array.isArray(content?.parts) ? content.parts : []).some(part =>
            Boolean(part?.inlineData || part?.fileData)
        )
    );
}

class GeminiTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`Gemini request timed out after ${Math.round(timeoutMs / 1000)}s.`);
        this.name = 'GeminiTimeoutError';
    }
}

async function fetchWithTimeout(fetchFn, url, init, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            try {
                controller?.abort();
            } catch {
                // Ignore abort failures.
            }
            reject(new GeminiTimeoutError(timeoutMs));
        }, timeoutMs);
    });

    try {
        return await Promise.race([
            fetchFn(url, controller ? { ...init, signal: controller.signal } : init),
            timeout
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/**
 * Pulls the text out of the first Gemini candidate and raises a useful error
 * when Google blocked or truncated the response. This prevents components
 * from receiving an empty string and staying in a loading/blank state.
 */
export function extractGeminiResponseText(response) {
    const candidate = response?.candidates?.[0];
    const parts = candidate?.content?.parts || [];
    const text = parts.map(part => part?.text || '').join('').trim();

    if (text) return text;

    const blockReason = response?.promptFeedback?.blockReason;
    if (blockReason) {
        throw new Error(`Gemini blocked this request (${blockReason}). Try rephrasing it.`);
    }

    if (candidate?.finishReason === 'SAFETY') {
        throw new Error('Gemini stopped the response for safety reasons. Try rephrasing your request.');
    }

    if (candidate?.finishReason === 'MAX_TOKENS') {
        throw new Error('Gemini reached its output limit before producing an answer. Please try again.');
    }

    return '';
}

async function discoverAvailableModels({ keys, fetchFn, timeoutMs }) {
    if (modelCache && Date.now() - modelCache.at < MODEL_CACHE_TTL_MS) {
        logAiEvent('gemini.models-cached', { count: modelCache.models.length });
        return modelCache.models;
    }

    const response = await fetchWithTimeout(
        fetchFn,
        `${GEMINI_CONFIG.apiBase}/models?pageSize=200`,
        {
            method: 'GET',
            headers: { 'x-goog-api-key': keys[activeKeyIndex % keys.length] }
        },
        timeoutMs
    );

    if (!response.ok) {
        throw new Error(`Model discovery failed with HTTP ${response.status}.`);
    }

    const body = await response.json();
    const models = (Array.isArray(body?.models) ? body.models : [])
        .filter(model => Array.isArray(model?.supportedGenerationMethods)
            && model.supportedGenerationMethods.includes('generateContent'))
        .map(model => String(model.name || '').replace(/^models\//, ''))
        .filter(Boolean);

    modelCache = { models, at: Date.now() };
    return models;
}

/**
 * Direct Gemini caller with user-supplied keys, bounded exponential backoff
 * and central model configuration. Keys live only in this device's local
 * storage and are never logged, bundled or placed in the request URL.
 *
 * - Authentication uses the documented `x-goog-api-key` header.
 * - Model availability is checked against Google's model list (cached for
 *   10 minutes) purely for diagnostics; the configured primary and fallback
 *   list never gains dynamically discovered models.
 * - Every model gets at most two attempts. Permanent errors (400 invalid key,
 *   401/403 auth or permission) fail immediately with Google's sanitized
 *   message and are never retried or key-rotated.
 * - Temporary errors (429, 5xx) retry once with bounded, jittered exponential
 *   backoff. Only 429 rotates to the next configured key (quota exhaustion is
 *   per key); server-side 5xx never rotates keys.
 * - 404 and repeated 5xx fall through to the next explicit configured model.
 * - Every request has a timeout and the whole call has a deadline, so callers
 *   can never hang indefinitely. Vision requests only consider models whose
 *   names identify them as multimodal Flash/Pro models.
 *
 * Test hooks are injected via `options` (keys, fetchImpl, delayFn) so the
 * error-handling matrix can be exercised without network access.
 */
export async function callGeminiDirect(payload, options = {}) {
    const feature = options.feature || 'ai';
    const configuredRetries = Number(options.maxRetries);
    const maxRetries = Number.isFinite(configuredRetries)
        ? Math.min(MAX_RETRIES_PER_MODEL, Math.max(0, Math.floor(configuredRetries)))
        : MAX_RETRIES_PER_MODEL;
    const requestTimeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    const totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    const deadline = Date.now() + totalTimeoutMs;
    const random = typeof options.random === 'function' ? options.random : Math.random;
    const requireVision = options.requireVision ?? payloadRequiresVision(payload);
    const envKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) || '';
    const storedKeys = loadGeminiKeys();
    const effectiveKeys = envKey ? [envKey, ...storedKeys.filter(k => k !== envKey)] : storedKeys;
    const keys = options.keys ?? effectiveKeys;
    const fetchFn = options.fetchImpl ?? fetch.bind(globalThis);
    const delayFn = options.delayFn ?? ((ms) => new Promise(resolve => setTimeout(resolve, ms)));

    if (keys.length === 0) {
        throw new Error(
            'No Gemini API key configured. Open AI Settings in the sidebar and add up to 5 keys.'
        );
    }

    const configuredModels = [GEMINI_CONFIG.model, ...GEMINI_CONFIG.fallbackModels];
    let models = configuredModels;

    if (requireVision) {
        models = configuredModels.filter(isVisionCapableModel);
        if (models.length === 0) {
            throw failWithLog(
                'None of the configured Gemini models can read images. Add a vision-capable Flash model to GEMINI_CONFIG.',
                { feature, models: configuredModels }
            );
        }
        logAiEvent('gemini.vision-check', { feature, models });
    }

    logAiEvent('gemini.start', {
        feature,
        keys: keys.length,
        primaryModel: GEMINI_CONFIG.model,
        fallbacks: GEMINI_CONFIG.fallbackModels,
        requireVision
    });

    // Verify model availability on real (network) calls. Discovery is only a
    // diagnostic/optimization: the configured fallback list stays explicit and
    // immutable. Tests that inject fetch skip discovery unless requested.
    const shouldDiscover = options.discoverModels ?? !options.fetchImpl;
    if (shouldDiscover) {
        try {
            const available = await discoverAvailableModels({
                keys,
                fetchFn,
                timeoutMs: Math.min(requestTimeoutMs, Math.max(2000, deadline - Date.now()))
            });
            const availableSet = new Set(available);
            const verified = configuredModels.filter(model => availableSet.has(model));
            logAiEvent('gemini.models', {
                feature,
                available: available.length,
                verified,
                order: models
            });
        } catch (error) {
            logAiEvent('gemini.models-unverified', {
                feature,
                reason: sanitizeGeminiErrorMessage(error.message)
            });
            // Discovery is an optimization only; generation still works when
            // the ListModels endpoint is blocked or temporarily unavailable.
        }
    }

    let lastDetail = '';

    for (let modelIndex = 0; modelIndex < models.length; modelIndex++) {
        if (Date.now() >= deadline) {
            throw failWithLog(
                'Gemini request timed out. Please check your connection and try again.',
                { feature, reason: 'deadline' }
            );
        }

        const model = models[modelIndex];
        const url = `${GEMINI_CONFIG.apiBase}/models/${model}:generateContent`;
        const maxAttempts = maxRetries;

        for (let attempt = 0; attempt <= maxAttempts; attempt++) {
            let response;
            const requestStartedAt = Date.now();
            const remainingMs = deadline - Date.now();
            if (remainingMs <= 0) {
                throw failWithLog(
                    'Gemini request timed out. Please check your connection and try again.',
                    { feature, model, reason: 'deadline' }
                );
            }

            const keyNumber = (activeKeyIndex % keys.length) + 1;
            logAiEvent('gemini.request', {
                feature,
                model,
                attempt: attempt + 1,
                maxAttempts: maxAttempts + 1,
                key: keyNumber
            });
            try {
                response = await fetchWithTimeout(fetchFn, url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'x-goog-api-key': keys[activeKeyIndex % keys.length]
                    },
                    body: JSON.stringify(payload)
                }, Math.min(requestTimeoutMs, remainingMs));
            } catch (err) {
                // Network/TLS/WebView failures are independent of model and
                // key: retry the same request with bounded, jittered backoff.
                const backoff = backoffDelayMs(attempt, random);
                const reason = err instanceof GeminiTimeoutError ? 'timeout' : 'network';
                const ms = Date.now() - requestStartedAt;
                logAiEvent('gemini.network-error', {
                    feature,
                    model,
                    attempt: attempt + 1,
                    key: keyNumber,
                    ms,
                    reason
                });
                if (attempt < maxRetries && Date.now() + backoff < deadline) {
                    logAiEvent('gemini.retry', {
                        feature,
                        model,
                        attempt: attempt + 1,
                        delayMs: backoff,
                        reason
                    });
                    await delayFn(backoff);
                    continue;
                }
                if (err instanceof GeminiTimeoutError) {
                    throw failWithLog(
                        `${err.message} The AI service may be busy — please try again in a moment.`,
                        { feature, model, attempt: attempt + 1, key: keyNumber, ms, reason }
                    );
                }
                throw failWithLog(
                    'Gemini request failed due to a network error. Check your internet connection and try again.',
                    { feature, model, attempt: attempt + 1, key: keyNumber, ms, reason }
                );
            }

            if (response.ok) {
                try {
                    const result = await response.json();
                    logAiEvent('gemini.success', {
                        feature,
                        model,
                        attempt: attempt + 1,
                        key: keyNumber,
                        ms: Date.now() - requestStartedAt
                    });
                    return result;
                } catch {
                    throw failWithLog(
                        'Gemini returned a malformed response body.',
                        {
                            feature,
                            model,
                            attempt: attempt + 1,
                            key: keyNumber,
                            ms: Date.now() - requestStartedAt,
                            reason: 'malformed-response'
                        }
                    );
                }
            }

            let errorBody = null;
            try {
                errorBody = await response.json();
            } catch {
                // Non-JSON error body; detail stays empty.
            }
            const detail = sanitizeGeminiErrorMessage(errorBody?.error?.message);
            const googleStatus = errorBody?.error?.status || '';

            const ms = Date.now() - requestStartedAt;

            if (!RETRYABLE_HTTP_STATUSES.has(response.status)) {
                // Permanent failures: 400 (invalid argument/key), 401/403
                // (authentication, permission, key restrictions) and 404
                // (model not found). Never retried and never key-rotated.
                logAiEvent('gemini.http-error', {
                    feature,
                    model,
                    attempt: attempt + 1,
                    key: keyNumber,
                    status: response.status,
                    googleStatus,
                    detail,
                    ms
                });

                if (response.status === 404 && modelIndex + 1 < models.length) {
                    logAiEvent('gemini.model-fallback', {
                        feature,
                        from: model,
                        to: models[modelIndex + 1],
                        reason: 'HTTP 404',
                        attempt: attempt + 1
                    });
                    break; // Try the fallback model instead.
                }
                if (response.status === 404) {
                    throw failWithLog(
                        `No Gemini model from the configured list (${models.slice(0, modelIndex + 1).join(', ')}) is available with your API keys (HTTP 404${googleStatus ? `, ${googleStatus}` : ''})${detail ? `: ${detail}` : '.'} The model list can be changed in client/src/services/ai/geminiProvider.js (GEMINI_CONFIG).`,
                        {
                            feature,
                            model,
                            attempt: attempt + 1,
                            key: keyNumber,
                            status: response.status,
                            ms
                        }
                    );
                }

                throw failWithLog(
                    `Gemini request failed (HTTP ${response.status}${googleStatus ? `, ${googleStatus}` : ''})${detail ? `: ${detail}` : '.'}`,
                    {
                        feature,
                        model,
                        attempt: attempt + 1,
                        key: keyNumber,
                        status: response.status,
                        googleStatus,
                        ms
                    }
                );
            }

            // Temporary failure: 429/5xx. Rotate keys only on quota
            // exhaustion; server-side 5xx uses the same key.
            logAiEvent('gemini.temporary-error', {
                feature,
                model,
                attempt: attempt + 1,
                key: keyNumber,
                status: response.status,
                googleStatus,
                detail,
                ms
            });
            lastDetail = detail || `temporary Gemini error (HTTP ${response.status}${googleStatus ? `, ${googleStatus}` : ''})`;
            const backoff = backoffDelayMs(attempt, random);
            if (attempt < maxRetries && Date.now() + backoff < deadline) {
                if (response.status === 429 && keys.length > 1) {
                    const previousKey = activeKeyIndex % keys.length;
                    activeKeyIndex = (activeKeyIndex + 1) % keys.length;
                    logAiEvent('gemini.key-rotate', {
                        feature,
                        reason: 'HTTP 429',
                        fromKey: previousKey + 1,
                        nextKey: (activeKeyIndex % keys.length) + 1
                    });
                }
                logAiEvent('gemini.retry', {
                    feature,
                    model,
                    attempt: attempt + 1,
                    status: response.status,
                    delayMs: backoff
                });
                await delayFn(backoff);
                continue;
            }
            if (response.status >= 500 && modelIndex + 1 < models.length) {
                logAiEvent('gemini.model-fallback', {
                    feature,
                    from: model,
                    to: models[modelIndex + 1],
                    reason: `HTTP ${response.status}`,
                    attempt: attempt + 1
                });
                break; // Try the next configured model.
            }
            throw failWithLog(
                `Gemini request failed after ${maxAttempts + 1} attempts: ${lastDetail}`,
                {
                    feature,
                    model,
                    attempt: attempt + 1,
                    key: keyNumber,
                    status: response.status,
                    googleStatus,
                    ms
                }
            );
        }
    }

    throw failWithLog(
        `No Gemini model from the configured list (${models.join(', ')}) is available for your API keys (HTTP 404).`,
        { feature, models }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// HIGH-LEVEL PROVIDER METHODS
// These accept the same generic shape as the Velona adapter so the local AI
// facade can switch providers without knowing request-format details.
// ─────────────────────────────────────────────────────────────────────────────

export async function completeText({
    systemPrompt,
    userPrompt,
    feature,
    maxOutputTokens = 4096,
    temperature = 0.7
}) {
    const payload = {
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig: { temperature, maxOutputTokens }
    };
    const response = await callGeminiDirect(payload, { feature });
    return extractGeminiResponseText(response);
}

export async function completeJson({
    systemPrompt,
    contents,
    feature,
    temperature = 0.2,
    maxOutputTokens,
    parse = null,
    requireVision = false
}) {
    const payload = {
        ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
        contents,
        generationConfig: {
            temperature,
            responseMimeType: 'application/json',
            ...(maxOutputTokens ? { maxOutputTokens } : {})
        }
    };

    const response = await callGeminiDirect(payload, { feature, requireVision });
    const text = extractGeminiResponseText(response).trim();
    if (!text) {
        throw new Error('Gemini returned an empty structured response. Please try again.');
    }

    try {
        return parse ? parse(text) : text;
    } catch {
        throw new Error(`Gemini returned invalid structured data for ${feature}. Please try again.`);
    }
}

export async function completeWithTools({
    systemPrompt,
    userPrompt,
    feature,
    declarations,
    executeTool,
    maxTurns = 5,
    conversationHistory = [],
    temperature = 0.7,
    maxOutputTokens = 4096
}) {
    const contents = [
        ...conversationHistory
            .filter(message => message && ['user', 'assistant'].includes(message.role)
                && typeof message.content === 'string' && message.content.trim())
            .map(message => ({
                role: message.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: message.content }]
            })),
        { role: 'user', parts: [{ text: userPrompt }] }
    ];

    const payload = {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        tools: [{ functionDeclarations: declarations }],
        generationConfig: { temperature, maxOutputTokens }
    };

    for (let turn = 0; turn < maxTurns; turn++) {
        const response = await callGeminiDirect(payload, { feature });
        const candidate = response?.candidates?.[0];
        const content = candidate?.content;

        if (!content) break;

        const functionCalls = content.parts?.filter(part => part.functionCall);

        if (!functionCalls || functionCalls.length === 0) {
            const reply = extractGeminiResponseText(response) || '';
            if (!reply.trim()) {
                throw new Error('Gemini returned an empty final answer. Please try again.');
            }
            return reply;
        }

        // Append the assistant turn (including function calls), then execute
        // every requested tool locally against the on-device database.
        contents.push(content);

        const responseParts = [];
        for (const part of functionCalls) {
            const call = part.functionCall;
            try {
                const result = await executeTool(call.name, call.args || {});
                responseParts.push({
                    functionResponse: {
                        name: call.name,
                        response: result
                    }
                });
            } catch (error) {
                responseParts.push({
                    functionResponse: {
                        name: call.name,
                        response: { error: error.message }
                    }
                });
            }
        }

        contents.push({ role: 'user', parts: responseParts });
    }

    throw new Error('The advisor exceeded its tool-call limit before finishing. Please ask again.');
}

export const geminiProvider = {
    id: 'gemini',
    getModel() {
        return GEMINI_CONFIG.model;
    },
    getFallbackModels() {
        return [...GEMINI_CONFIG.fallbackModels];
    },
    getConfig() {
        const keyCount = loadGeminiKeys().length;
        return {
            configured: keyCount > 0,
            keyCount,
            model: GEMINI_CONFIG.model,
            fallbackModels: [...GEMINI_CONFIG.fallbackModels]
        };
    },
    supportsImages() {
        return [GEMINI_CONFIG.model, ...GEMINI_CONFIG.fallbackModels]
            .some(isVisionCapableModel);
    },
    completeText,
    completeJson,
    completeWithTools
};
