import { VELONA_CONFIG } from './aiConfig.js';
import { isVelonaEnabled, loadVelonaKey } from './providerSettings.js';
import { logAiEvent } from '../aiLogger.js';

/**
 * Velona transport (OpenAI-compatible surface).
 *
 * Docs: POST https://velona.in/v1/chat/completions
 * Auth: Authorization: Bearer <user key>
 * Model: qwen/qwen3.7-flash (vision-language)
 *
 * The user's key is read from device storage on every call. It is never
 * logged and never placed in a URL.
 */

const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const SUPPORTED_IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif'
]);

class VelonaTimeoutError extends Error {
    constructor(timeoutMs) {
        super(`Velona request timed out after ${Math.round(timeoutMs / 1000)}s.`);
        this.name = 'VelonaTimeoutError';
    }
}

export function sanitizeVelonaErrorMessage(message) {
    return String(message || '')
        .replace(/key_[A-Za-z0-9._-]+/g, '[redacted]')
        .replace(/sk-[A-Za-z0-9._-]+/g, '[redacted]')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [redacted]')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
}

function backoffDelayMs(attempt, random = Math.random) {
    const base = Math.min(1000 * 2 ** attempt, VELONA_CONFIG.maxRetryWaitMs);
    const jitter = 0.5 + (random() * 0.5);
    return Math.round(base * jitter);
}

function friendlyError(status, body) {
    const detail = sanitizeVelonaErrorMessage(body?.error?.message);
    const suffix = detail ? ` ${detail}` : '';

    switch (status) {
        case 400:
            return `Velona rejected the request (HTTP 400).${suffix} Check the selected model and try again.`;
        case 401:
            return `Velona authentication failed (HTTP 401).${suffix} Check your Velona API key in AI Settings.`;
        case 402:
            return `Velona says this account has insufficient credits (HTTP 402).${suffix} Top up your Velona account or switch to Gemini in AI Settings.`;
        case 403:
            return `Velona denied access (HTTP 403).${suffix} Check that your Velona key is active and allowed to use this model.`;
        case 404:
            return `Velona could not find the requested model or endpoint (HTTP 404).${suffix}`;
        case 408:
            return `Velona timed out while generating a response (HTTP 408). Please try again.`;
        case 413:
            return `The image is too large for Velona (HTTP 413). Use an image under 8 MB.`;
        case 422:
            return `Velona could not process this request (HTTP 422).${suffix} Try a clearer image or a shorter message.`;
        case 429:
            return `Velona is rate-limiting requests or the account is out of quota (HTTP 429).${suffix} Wait a moment or switch providers in AI Settings.`;
        default:
            if (status >= 500) {
                return `Velona is temporarily unavailable (HTTP ${status}).${suffix} Please try again in a moment.`;
            }
            return `Velona request failed (HTTP ${status}).${suffix}`;
    }
}

function truncationMessage(feature) {
    if (feature === 'scan-receipt') {
        return 'Velona reached its output limit before finishing the receipt. Try a clearer photo with fewer items, or switch to Gemini in AI Settings.';
    }
    return 'Velona reached its output limit before producing an answer. Please try again.';
}

function validateImage(inlineData) {
    const mimeType = String(inlineData?.mimeType || '').toLowerCase();
    const data = inlineData?.data;

    if (!data || typeof data !== 'string') {
        throw new Error('The image data is missing or unreadable. Please choose the image again.');
    }
    if (!SUPPORTED_IMAGE_MIME_TYPES.has(mimeType)) {
        throw new Error(
            'Velona supports JPEG, PNG, WebP and GIF images. Convert this photo to JPEG (or switch to Gemini in AI Settings) and try again.'
        );
    }

    const estimatedBytes = Math.floor((data.length * 3) / 4);
    if (estimatedBytes > VELONA_CONFIG.maxImageBytes) {
        throw new Error('The image is larger than 8 MB. Choose a smaller photo and try again.');
    }
}

function toOpenAiMessages(contents) {
    return (Array.isArray(contents) ? contents : []).map(content => {
        const role = content?.role === 'model' ? 'assistant' : (content?.role || 'user');
        const parts = Array.isArray(content?.parts) ? content.parts : [];
        const text = parts.filter(part => typeof part?.text === 'string').map(part => part.text).join('\n');
        const images = parts.filter(part => part?.inlineData);

        if (images.length === 0) {
            return { role, content: text };
        }

        const contentParts = [];
        if (text) contentParts.push({ type: 'text', text });
        for (const part of images) {
            validateImage(part.inlineData);
            contentParts.push({
                type: 'image_url',
                image_url: {
                    url: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                }
            });
        }
        return { role, content: contentParts };
    }).filter(message => {
        if (Array.isArray(message.content)) return message.content.length > 0;
        return typeof message.content === 'string' && message.content.trim().length > 0;
    });
}

function normalizeToolDeclarations(declarations) {
    if (!Array.isArray(declarations) || declarations.length === 0) return [];
    return declarations.map(declaration => ({
        type: 'function',
        function: {
            name: declaration.name,
            description: declaration.description,
            parameters: declaration.parameters
        }
    }));
}

function toOpenAiMessagesWithHistory(systemPrompt, conversationHistory, userPrompt) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    for (const message of Array.isArray(conversationHistory) ? conversationHistory : []) {
        if (!message || !['user', 'assistant'].includes(message.role)) continue;
        if (typeof message.content !== 'string' || !message.content.trim()) continue;
        messages.push({ role: message.role, content: message.content });
    }
    messages.push({ role: 'user', content: userPrompt });
    return messages;
}

function extractMessage(body) {
    const choice = body?.choices?.[0];
    const message = choice?.message || {};

    let content = message.content;
    if (Array.isArray(content)) {
        content = content.map(part => part?.text || '').join('');
    }

    // Defensive support for Velona's native response envelope in case the
    // compatible endpoint ever returns it.
    if (!content && typeof body?.data?.output === 'string') {
        content = body.data.output;
    }
    if (!content && body?.data?.output && typeof body.data.output === 'object') {
        content = JSON.stringify(body.data.output);
    }

    return {
        content: typeof content === 'string' ? content : '',
        role: message.role || 'assistant',
        toolCalls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
        finishReason: choice?.finish_reason || body?.data?.finish || null,
        usage: body?.usage || body?.data?.usage || null
    };
}

function isTruncated(finishReason) {
    const value = String(finishReason || '').toLowerCase();
    return value === 'length' || value === 'max_tokens' || value === 'max_output_tokens';
}

async function fetchWithTimeout(url, init, timeoutMs) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let timer = null;
    const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => {
            try {
                controller?.abort();
            } catch {
                // Ignore abort failures.
            }
            reject(new VelonaTimeoutError(timeoutMs));
        }, timeoutMs);
    });

    try {
        return await Promise.race([
            fetch(url, controller ? { ...init, signal: controller.signal } : init),
            timeout
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

async function request({ feature, body, timeoutMs, maxRetries = VELONA_CONFIG.maxRetries, random = Math.random, delayFn }) {
    if (!isVelonaEnabled()) {
        throw new Error('Velona is turned off. Open AI Settings in the sidebar to enable it or choose another provider.');
    }

    const apiKey = loadVelonaKey();
    if (!apiKey) {
        throw new Error('No Velona API key is configured. Open AI Settings in the sidebar to add one.');
    }

    const wait = delayFn || ((ms) => new Promise(resolve => setTimeout(resolve, ms)));
    const effectiveTimeout = timeoutMs || VELONA_CONFIG.requestTimeoutMs;
    const imageCount = (Array.isArray(body?.messages) ? body.messages : [])
        .reduce((count, message) => count + (Array.isArray(message?.content)
            ? message.content.filter(part => part?.type === 'image_url').length
            : 0), 0);

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        logAiEvent('velona.request', {
            feature,
            model: VELONA_CONFIG.model,
            attempt: attempt + 1,
            maxAttempts: maxRetries + 1,
            messages: Array.isArray(body?.messages) ? body.messages.length : 0,
            imageCount
        });

        const startedAt = Date.now();
        let response;

        try {
            response = await fetchWithTimeout(VELONA_CONFIG.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${apiKey}`
                },
                body: JSON.stringify({
                    model: VELONA_CONFIG.model,
                    ...body
                })
            }, effectiveTimeout);
        } catch (error) {
            const isTimeout = error instanceof VelonaTimeoutError;
            logAiEvent('velona.network-error', {
                feature,
                attempt: attempt + 1,
                ms: Date.now() - startedAt,
                reason: isTimeout ? 'timeout' : 'network',
                error: sanitizeVelonaErrorMessage(error.message)
            });

            lastError = isTimeout
                ? new Error('Velona request timed out. Please check your connection and try again.')
                : new Error('Velona request failed due to a network error. Check your internet connection and try again.');

            if (attempt < maxRetries) {
                const backoff = backoffDelayMs(attempt, random);
                await wait(backoff);
                continue;
            }
            throw lastError;
        }

        let responseBody = null;
        try {
            responseBody = await response.json();
        } catch {
            responseBody = null;
        }

        if (response.ok) {
            const parsed = extractMessage(responseBody);
            logAiEvent('velona.success', {
                feature,
                attempt: attempt + 1,
                ms: Date.now() - startedAt,
                finishReason: parsed.finishReason,
                promptTokens: parsed.usage?.prompt_tokens,
                completionTokens: parsed.usage?.completion_tokens,
                hasToolCalls: parsed.toolCalls.length > 0
            });
            return { ...parsed, raw: responseBody };
        }

        const error = new Error(friendlyError(response.status, responseBody));
        logAiEvent('velona.http-error', {
            feature,
            attempt: attempt + 1,
            status: response.status,
            ms: Date.now() - startedAt,
            error: sanitizeVelonaErrorMessage(responseBody?.error?.message)
        });

        if (!RETRYABLE_HTTP_STATUSES.has(response.status)) {
            throw error;
        }

        lastError = error;
        if (attempt < maxRetries) {
            const backoff = backoffDelayMs(attempt, random);
            logAiEvent('velona.retry', {
                feature,
                attempt: attempt + 1,
                status: response.status,
                delayMs: backoff
            });
            await wait(backoff);
        }
    }

    throw lastError || new Error('Velona request failed. Please try again.');
}

// ─────────────────────────────────────────────────────────────────────────────
// HIGH-LEVEL PROVIDER METHODS
// ─────────────────────────────────────────────────────────────────────────────

export async function completeText({
    systemPrompt,
    userPrompt,
    feature,
    maxOutputTokens = 4096,
    temperature = 0.7
}) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: userPrompt });

    const result = await request({
        feature,
        body: {
            messages,
            temperature,
            max_tokens: maxOutputTokens
        }
    });

    if (isTruncated(result.finishReason)) {
        throw new Error(truncationMessage(feature));
    }
    if (!result.content.trim()) {
        throw new Error('Velona returned an empty response. Please try again.');
    }
    return result.content.trim();
}

export async function completeJson({
    systemPrompt,
    contents,
    feature,
    temperature = 0.2,
    maxOutputTokens,
    parse = null
}) {
    const messages = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push(...toOpenAiMessages(contents));

    if (messages.filter(message => message.role !== 'system').length === 0) {
        throw new Error('There was nothing to send to Velona. Please try again.');
    }

    const timeoutMs = feature === 'scan-receipt'
        ? VELONA_CONFIG.imageRequestTimeoutMs
        : VELONA_CONFIG.requestTimeoutMs;

    const result = await request({
        feature,
        timeoutMs,
        body: {
            messages,
            temperature,
            response_format: { type: 'json_object' },
            ...(maxOutputTokens ? { max_tokens: maxOutputTokens } : {})
        }
    });

    if (isTruncated(result.finishReason)) {
        throw new Error(truncationMessage(feature));
    }

    const text = result.content.trim();
    if (!text) {
        throw new Error('Velona returned an empty structured response. Please try again.');
    }

    try {
        return parse ? parse(text) : text;
    } catch {
        throw new Error('Velona returned invalid structured data. Please try again.');
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
    const tools = normalizeToolDeclarations(declarations);
    const messages = toOpenAiMessagesWithHistory(systemPrompt, conversationHistory, userPrompt);

    for (let turn = 0; turn < maxTurns; turn++) {
        const result = await request({
            feature,
            body: {
                messages,
                temperature,
                max_tokens: maxOutputTokens,
                ...(tools.length > 0 ? { tools, tool_choice: 'auto' } : {})
            }
        });

        if (isTruncated(result.finishReason)) {
            throw new Error(truncationMessage(feature));
        }

        if (result.toolCalls.length === 0) {
            const reply = result.content.trim();
            if (!reply) {
                throw new Error('Velona returned an empty final answer. Please try again.');
            }
            return reply;
        }

        // Append the assistant turn (with its tool calls) before adding the
        // matching tool results. Every result is computed locally.
        messages.push({
            role: 'assistant',
            content: result.content || null,
            tool_calls: result.toolCalls
        });

        for (const toolCall of result.toolCalls) {
            const name = toolCall?.function?.name || '';
            let args = {};
            try {
                args = JSON.parse(toolCall?.function?.arguments || '{}');
            } catch {
                args = {};
            }

            let output;
            try {
                output = await executeTool(name, args || {});
            } catch (error) {
                output = { error: error.message };
            }

            messages.push({
                role: 'tool',
                tool_call_id: toolCall?.id || `call_${turn}_${name}`,
                name,
                content: JSON.stringify(output)
            });
        }
    }

    throw new Error('The advisor exceeded its tool-call limit before finishing. Please ask again.');
}

export function getVelonaConfig() {
    const key = loadVelonaKey();
    return {
        configured: Boolean(key),
        enabled: isVelonaEnabled(),
        keyMasked: key ? `${key.slice(0, 4)}…${key.slice(-4)}` : '',
        model: VELONA_CONFIG.model,
        apiUrl: VELONA_CONFIG.apiUrl
    };
}

export const velonaProvider = {
    id: 'velona',
    getModel() {
        return VELONA_CONFIG.model;
    },
    getFallbackModels() {
        return [];
    },
    getConfig: getVelonaConfig,
    supportsImages() {
        // qwen/qwen3.7-flash is a vision-language model.
        return true;
    },
    completeText,
    completeJson,
    completeWithTools
};
