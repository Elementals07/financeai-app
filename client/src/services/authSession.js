/**
 * Authentication Session Storage
 * Explicitly tracks which profile is authenticated so the app never falls
 * back to "first record in the database" as the current user.
 *
 * Storage keys:
 *  - token        : legacy/local session token ('standalone_token_<id>')
 *  - user         : cached user object (validated against auth_user_id)
 *  - auth_user_id : the authenticated profile id (source of truth)
 */

export const SESSION_KEYS = {
    TOKEN: 'token',
    USER: 'user',
    USER_ID: 'auth_user_id'
};

// Node-safe memory fallback (browser always uses localStorage)
const memoryStore = new Map();
const isBrowser = typeof window !== 'undefined' && !!window.localStorage;

function rawGet(key) {
    if (isBrowser) {
        try {
            const value = window.localStorage.getItem(key);
            return value === null || value === undefined ? null : String(value);
        } catch {
            return null;
        }
    }
    return memoryStore.has(key) ? memoryStore.get(key) : null;
}

function rawSet(key, value) {
    if (isBrowser) {
        try {
            window.localStorage.setItem(key, String(value));
        } catch (e) {
            console.error('Failed to persist session value', e);
        }
        return;
    }
    memoryStore.set(key, String(value));
}

function rawRemove(key) {
    if (isBrowser) {
        try {
            window.localStorage.removeItem(key);
        } catch (e) {
            console.error('Failed to clear session value', e);
        }
        return;
    }
    memoryStore.delete(key);
}

export function getStoredToken() {
    return rawGet(SESSION_KEYS.TOKEN);
}

export function getStoredUserId() {
    const raw = rawGet(SESSION_KEYS.USER_ID);
    if (!raw) return null;
    const id = parseInt(raw, 10);
    return Number.isFinite(id) && id > 0 ? id : null;
}

export function getStoredUser() {
    try {
        const raw = rawGet(SESSION_KEYS.USER);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function setStoredToken(token) {
    rawSet(SESSION_KEYS.TOKEN, token);
}

export function setStoredUser(user) {
    rawSet(SESSION_KEYS.USER, JSON.stringify(user));
}

export function setStoredUserId(userId) {
    rawSet(SESSION_KEYS.USER_ID, userId);
}

/** Clears the complete session (token, cached user, authenticated id). */
export function clearSession() {
    rawRemove(SESSION_KEYS.TOKEN);
    rawRemove(SESSION_KEYS.USER);
    rawRemove(SESSION_KEYS.USER_ID);
}
