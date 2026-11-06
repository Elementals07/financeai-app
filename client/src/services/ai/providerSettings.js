import { loadGeminiKeys, getGeminiKeyCount } from '../geminiKeys.js';
import { AI_PROVIDERS, AI_PROVIDER_LABELS, isSupportedProvider } from './aiConfig.js';

/**
 * Device-local AI provider preferences.
 *
 * Keys are stored per device (never sent anywhere except directly to the
 * provider). Provider preference and enable/disable flags are also local.
 * Nothing in this module ever logs or returns a full key.
 */

export const AI_SETTINGS_STORAGE_KEYS = Object.freeze({
    velonaKey: 'financeai_velona_api_key',
    velonaEnabled: 'financeai_velona_enabled',
    geminiEnabled: 'financeai_gemini_enabled',
    provider: 'financeai_ai_provider'
});

export const AI_SETTINGS_EVENT = 'financeai:ai-settings-changed';

const VELONA_KEY_PATTERN = /^[A-Za-z0-9._-]{10,300}$/;

const memoryStorage = new Map();

function getStorage(storage) {
    if (storage) return storage;
    try {
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
        // localStorage can throw in private/embedded contexts.
    }
    return null;
}

function readRaw(name, storage) {
    const target = getStorage(storage);
    if (target) {
        try {
            const value = target.getItem(name);
            if (value !== null) return value;
        } catch {
            // Fall through to in-memory fallback.
        }
    }
    return memoryStorage.has(name) ? memoryStorage.get(name) : null;
}

function writeRaw(name, value, storage) {
    memoryStorage.set(name, value);
    const target = getStorage(storage);
    if (target) {
        try {
            target.setItem(name, value);
        } catch {
            // Keep the in-memory value so the current session still works.
        }
    }
}

function removeRaw(name, storage) {
    memoryStorage.delete(name);
    const target = getStorage(storage);
    if (target) {
        try {
            target.removeItem(name);
        } catch {
            // Ignore storage failures.
        }
    }
}

function readBoolean(name, fallback, storage) {
    const value = readRaw(name, storage);
    if (value === 'true') return true;
    if (value === 'false') return false;
    return fallback;
}

export function emitAIProviderSettingsChanged() {
    if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
    try {
        window.dispatchEvent(new CustomEvent(AI_SETTINGS_EVENT));
    } catch {
        // CustomEvent may be unavailable in legacy embedded browsers.
    }
}

/**
 * Subscribes to provider settings changes made in this tab (custom event) or
 * in another tab/window (storage event). Returns an unsubscribe function.
 */
export function subscribeAIProviderSettings(listener) {
    if (typeof window === 'undefined' || typeof listener !== 'function') {
        return () => {};
    }
    const keys = new Set(Object.values(AI_SETTINGS_STORAGE_KEYS));
    const onCustom = () => listener(getAIProviderStatus());
    const onStorage = (event) => {
        if (!event?.key || keys.has(event.key)) listener(getAIProviderStatus());
    };
    window.addEventListener(AI_SETTINGS_EVENT, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(AI_SETTINGS_EVENT, onCustom);
        window.removeEventListener('storage', onStorage);
    };
}

// ─────────────────────────────────────────────────────────────────────────────
// Velona key
// ─────────────────────────────────────────────────────────────────────────────

export function normalizeVelonaKey(value) {
    return typeof value === 'string' ? value.trim() : '';
}

export function getVelonaKeyValidationError(value) {
    const key = normalizeVelonaKey(value);
    if (!key) return 'Enter a Velona API key.';
    if (!VELONA_KEY_PATTERN.test(key)) {
        return 'That does not look like a valid Velona API key. Paste the key from your Velona dashboard (letters, numbers, dots, dashes and underscores only).';
    }
    return null;
}

export function loadVelonaKey(storage) {
    return normalizeVelonaKey(readRaw(AI_SETTINGS_STORAGE_KEYS.velonaKey, storage));
}

export function saveVelonaKey(value, storage) {
    const key = normalizeVelonaKey(value);
    const error = getVelonaKeyValidationError(key);
    if (error) throw new Error(error);
    writeRaw(AI_SETTINGS_STORAGE_KEYS.velonaKey, key, storage);
    // Saving a key signals intent to use Velona, so make sure it is enabled.
    writeRaw(AI_SETTINGS_STORAGE_KEYS.velonaEnabled, 'true', storage);
    emitAIProviderSettingsChanged();
    return key;
}

export function clearVelonaKey(storage) {
    removeRaw(AI_SETTINGS_STORAGE_KEYS.velonaKey, storage);
    emitAIProviderSettingsChanged();
}

export function maskSecretKey(value) {
    const key = normalizeVelonaKey(value);
    if (!key) return '';
    if (key.length <= 10) return '••••••';
    return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

export const maskVelonaKey = maskSecretKey;

// ─────────────────────────────────────────────────────────────────────────────
// Provider enable / disable
// ─────────────────────────────────────────────────────────────────────────────

export function isVelonaEnabled(storage) {
    return readBoolean(AI_SETTINGS_STORAGE_KEYS.velonaEnabled, true, storage);
}

export function setVelonaEnabled(enabled, storage) {
    writeRaw(AI_SETTINGS_STORAGE_KEYS.velonaEnabled, enabled ? 'true' : 'false', storage);
    emitAIProviderSettingsChanged();
}

export function isGeminiEnabled(storage) {
    return readBoolean(AI_SETTINGS_STORAGE_KEYS.geminiEnabled, true, storage);
}

export function setGeminiEnabled(enabled, storage) {
    writeRaw(AI_SETTINGS_STORAGE_KEYS.geminiEnabled, enabled ? 'true' : 'false', storage);
    emitAIProviderSettingsChanged();
}

// ─────────────────────────────────────────────────────────────────────────────
// Preferred provider
// ─────────────────────────────────────────────────────────────────────────────

export function getAIProviderPreference(storage) {
    const value = readRaw(AI_SETTINGS_STORAGE_KEYS.provider, storage);
    return isSupportedProvider(value) ? value : null;
}

export function setAIProviderPreference(provider, storage) {
    if (!isSupportedProvider(provider)) {
        throw new Error('Choose either Velona or Google Gemini.');
    }
    writeRaw(AI_SETTINGS_STORAGE_KEYS.provider, provider, storage);
    emitAIProviderSettingsChanged();
}

export function clearAIProviderPreference(storage) {
    removeRaw(AI_SETTINGS_STORAGE_KEYS.provider, storage);
    emitAIProviderSettingsChanged();
}

// ─────────────────────────────────────────────────────────────────────────────
// Status resolution
// ─────────────────────────────────────────────────────────────────────────────

function buildStatus(storage) {
    const velonaKey = loadVelonaKey(storage);
    const geminiKeyCount = typeof getGeminiKeyCount === 'function'
        ? getGeminiKeyCount()
        : loadGeminiKeys().length;

    return {
        preference: getAIProviderPreference(storage),
        velona: {
            enabled: isVelonaEnabled(storage),
            configured: Boolean(velonaKey),
            keyMasked: maskVelonaKey(velonaKey)
        },
        gemini: {
            enabled: isGeminiEnabled(storage),
            configured: geminiKeyCount > 0,
            keyCount: geminiKeyCount
        }
    };
}

function isAvailable(status, provider) {
    return Boolean(status?.[provider]?.enabled && status?.[provider]?.configured);
}

function computeActiveProvider(status) {
    const preference = status.preference;

    if (isSupportedProvider(preference)) {
        if (isAvailable(status, preference)) {
            return { provider: preference, reason: null };
        }
        return {
            provider: null,
            reason: `${preference}_unavailable`
        };
    }

    // No explicit preference: prefer Velona when it is ready, otherwise fall
    // back to Gemini. This is the documented default ordering, not a silent
    // switch away from a user's saved choice.
    if (isAvailable(status, AI_PROVIDERS.VELONA)) {
        return { provider: AI_PROVIDERS.VELONA, reason: null };
    }
    if (isAvailable(status, AI_PROVIDERS.GEMINI)) {
        return { provider: AI_PROVIDERS.GEMINI, reason: null };
    }
    return { provider: null, reason: 'not_configured' };
}

export function describeProviderUnavailable(reason, status = {}) {
    const preference = status.preference;
    if (reason === 'not_configured') {
        return 'No AI provider is configured. Open AI Settings in the sidebar to add a Velona or Gemini API key.';
    }
    if (reason === `${AI_PROVIDERS.VELONA}_unavailable` && preference === AI_PROVIDERS.VELONA) {
        if (!status.velona?.enabled) {
            return 'Velona is turned off. Open AI Settings in the sidebar to enable it or choose another provider.';
        }
        return 'Your selected provider, Velona, has no API key. Open AI Settings in the sidebar to add one or choose another provider.';
    }
    if (reason === `${AI_PROVIDERS.GEMINI}_unavailable` && preference === AI_PROVIDERS.GEMINI) {
        if (!status.gemini?.enabled) {
            return 'Google Gemini is turned off. Open AI Settings in the sidebar to enable it or choose another provider.';
        }
        return 'Your selected provider, Google Gemini, has no API key. Open AI Settings in the sidebar to add one or choose another provider.';
    }
    return 'The selected AI provider is not available. Open AI Settings in the sidebar.';
}

export function getAIProviderStatus(storage) {
    const status = buildStatus(storage);
    const active = computeActiveProvider(status);
    return {
        ...status,
        activeProvider: active.provider,
        activeProviderLabel: active.provider ? AI_PROVIDER_LABELS[active.provider] : null,
        unavailableReason: active.reason,
        unavailableMessage: active.reason
            ? describeProviderUnavailable(active.reason, status)
            : null
    };
}

/**
 * Returns the provider that should serve the next request. A saved preference
 * is never silently replaced: if the preferred provider is disabled or has no
 * key, the request fails with a clear settings message instead of spending
 * money on another provider.
 */
export function resolveActiveProvider(storage) {
    const status = getAIProviderStatus(storage);
    return {
        provider: status.activeProvider,
        reason: status.unavailableReason,
        message: status.unavailableMessage,
        status
    };
}
