import { geminiProvider } from './geminiProvider.js';
import { velonaProvider } from './velonaProvider.js';
import { AI_PROVIDERS, AI_PROVIDER_LABELS, isSupportedProvider } from './aiConfig.js';
import { resolveActiveProvider } from './providerSettings.js';

/**
 * Single entry point for the local AI facade. Resolves the active provider,
 * exposes a provider-agnostic request surface and produces the identity rows
 * used to scope cache entries per provider/model.
 */

const PROVIDERS = Object.freeze({
    [AI_PROVIDERS.VELONA]: velonaProvider,
    [AI_PROVIDERS.GEMINI]: geminiProvider
});

export function getProviderAdapter(provider) {
    if (!isSupportedProvider(provider)) {
        throw new Error(`Unknown AI provider: ${provider}`);
    }
    return PROVIDERS[provider];
}

export function getProviderLabel(provider) {
    return AI_PROVIDER_LABELS[provider] || 'AI';
}

/**
 * Resolves the provider for the next request. Throws a clear, settings-level
 * error instead of silently falling back when the user's chosen provider is
 * unavailable.
 */
export function requireActiveProvider(storage) {
    const resolution = resolveActiveProvider(storage);
    if (!resolution.provider) {
        const error = new Error(resolution.message
            || 'No AI provider is available. Open AI Settings in the sidebar.');
        error.code = 'AI_PROVIDER_UNAVAILABLE';
        error.reason = resolution.reason;
        error.status = resolution.status;
        throw error;
    }

    const adapter = getProviderAdapter(resolution.provider);
    return {
        provider: resolution.provider,
        label: getProviderLabel(resolution.provider),
        adapter,
        model: adapter.getModel(),
        fallbackModels: adapter.getFallbackModels(),
        status: resolution.status
    };
}

export function getProviderCacheParams(context) {
    return {
        provider: context.provider,
        model: context.model,
        fallbackModels: context.fallbackModels
    };
}

export async function callProviderText(options) {
    const context = requireActiveProvider(options?.storage);
    return context.adapter.completeText(options);
}

export async function callProviderJson(options) {
    const context = requireActiveProvider(options?.storage);
    return context.adapter.completeJson(options);
}

export async function callProviderWithTools(options) {
    const context = requireActiveProvider(options?.storage);
    return context.adapter.completeWithTools(options);
}
