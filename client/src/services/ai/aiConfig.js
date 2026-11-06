/**
 * Shared AI provider configuration.
 *
 * This module contains only non-secret provider metadata. API keys are read
 * from device storage by the individual provider adapters and never live here.
 */

export const AI_PROVIDERS = Object.freeze({
    VELONA: 'velona',
    GEMINI: 'gemini'
});

export const AI_CACHE_VERSION = 2;

export const VELONA_CONFIG = Object.freeze({
    // Official OpenAI-compatible surface documented at https://velona.in/docs
    apiUrl: 'https://velona.in/v1/chat/completions',
    model: 'qwen/qwen3.7-flash',
    requestTimeoutMs: 45_000,
    // Velona documents that non-streaming requests must finish within 90s.
    // Vision requests can legitimately need the full window when reading a
    // long receipt, so they get their own deadline.
    imageRequestTimeoutMs: 90_000,
    maxRetries: 2,
    maxRetryWaitMs: 30_000,
    maxImageBytes: 8 * 1024 * 1024
});

// Models are configured centrally. The Gemini transport keeps its own model
// list in geminiProvider.js so the existing rotation/fallback behaviour is
// preserved exactly.
export const AI_PROVIDER_LABELS = Object.freeze({
    [AI_PROVIDERS.VELONA]: 'Velona',
    [AI_PROVIDERS.GEMINI]: 'Google Gemini'
});

export function isSupportedProvider(value) {
    return value === AI_PROVIDERS.VELONA || value === AI_PROVIDERS.GEMINI;
}
