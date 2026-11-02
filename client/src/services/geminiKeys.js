export const MAX_GEMINI_KEYS = 5;
export const GEMINI_KEYS_STORAGE_KEY = 'financeai_gemini_api_keys';

const GEMINI_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;

function resolveStorage(storage) {
    if (storage !== undefined) return storage;

    try {
        if (typeof window !== 'undefined' && window.localStorage) {
            return window.localStorage;
        }
    } catch {
        // Storage can be blocked by browser privacy settings.
    }

    return null;
}

export function normalizeGeminiKey(value) {
    if (typeof value !== 'string') return '';

    const key = value.trim();
    if (!key || !GEMINI_KEY_PATTERN.test(key)) return '';

    return key;
}

export function getGeminiKeyValidationError(value) {
    const key = typeof value === 'string' ? value.trim() : '';
    if (!key) return '';
    if (!GEMINI_KEY_PATTERN.test(key)) {
        return 'Gemini API keys can only contain letters, numbers, hyphens, and underscores.';
    }
    return '';
}

export function normalizeGeminiKeys(values) {
    if (!Array.isArray(values)) return [];

    const keys = [];
    const seen = new Set();

    for (const value of values) {
        const key = normalizeGeminiKey(value);
        if (!key || seen.has(key)) continue;

        seen.add(key);
        keys.push(key);

        if (keys.length >= MAX_GEMINI_KEYS) break;
    }

    return keys;
}

export function maskGeminiKey(value) {
    const key = normalizeGeminiKey(value);
    if (!key) return '';
    if (key.length <= 8) return '********';

    return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

export function loadGeminiKeys(storage) {
    const target = resolveStorage(storage);
    if (!target) return [];

    try {
        const raw = target.getItem(GEMINI_KEYS_STORAGE_KEY);
        if (!raw) return [];

        const parsed = JSON.parse(raw);
        return normalizeGeminiKeys(Array.isArray(parsed) ? parsed : []);
    } catch {
        return [];
    }
}

export function saveGeminiKeys(values, storage) {
    const target = resolveStorage(storage);
    const keys = normalizeGeminiKeys(values);

    if (!target) {
        throw new Error('Browser storage is unavailable on this device.');
    }

    try {
        target.setItem(GEMINI_KEYS_STORAGE_KEY, JSON.stringify(keys));
    } catch {
        throw new Error('Could not save Gemini API keys on this device.');
    }

    return keys;
}

export function clearGeminiKeys(storage) {
    const target = resolveStorage(storage);
    if (!target) return;

    try {
        target.removeItem(GEMINI_KEYS_STORAGE_KEY);
    } catch {
        throw new Error('Could not remove Gemini API keys from this device.');
    }
}

export function getGeminiKeyCount(storage) {
    return loadGeminiKeys(storage).length;
}
