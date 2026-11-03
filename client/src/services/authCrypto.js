/**
 * Local Password Hashing
 * Web Crypto PBKDF2 (HMAC-SHA256) with a unique random salt per account.
 * Passwords are never stored or logged in plaintext.
 */

const DEFAULT_ITERATIONS = 150000;

function getCryptoSubtle() {
    const c = globalThis.crypto;
    if (!c || !c.subtle) {
        throw new Error('Web Crypto is not available in this environment.');
    }
    return c.subtle;
}

function toArrayBufferSource(bytes) {
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function toBase64(buffer) {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoaSafe(binary);
}

function btoaSafe(binary) {
    if (typeof window !== 'undefined' && typeof window.btoa === 'function') {
        return window.btoa(binary);
    }
    const nodeBuffer = globalThis.Buffer;
    if (typeof nodeBuffer === 'function') {
        return nodeBuffer.from(binary, 'binary').toString('base64');
    }
    throw new Error('No base64 encoder available (browser btoa or Node Buffer).');
}

function fromBase64(value) {
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
        const binary = window.atob(value);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }
    const nodeBuffer = globalThis.Buffer;
    if (typeof nodeBuffer === 'function') {
        const buf = nodeBuffer.from(value, 'base64');
        return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    }
    throw new Error('No base64 decoder available (browser atob or Node Buffer).');
}

async function derive(password, saltBytes, iterations) {
    const subtle = getCryptoSubtle();
    const keyMaterial = await subtle.importKey(
        'raw',
        toArrayBufferSource(new TextEncoder().encode(String(password))),
        'PBKDF2',
        false,
        ['deriveBits']
    );
    return subtle.deriveBits(
        {
            name: 'PBKDF2',
            salt: toArrayBufferSource(saltBytes),
            iterations,
            hash: 'SHA-256'
        },
        keyMaterial,
        256
    );
}

/**
 * Hashes a password, returning fields ready to persist on the profile:
 * { password_salt, password_hash, password_iterations }
 */
export async function hashPassword(password, saltBytes = null, iterations = DEFAULT_ITERATIONS) {
    const effectiveSalt = saltBytes || crypto.getRandomValues(new Uint8Array(16));
    const derived = await derive(password, effectiveSalt, iterations);
    return {
        password_salt: toBase64(effectiveSalt),
        password_hash: toBase64(derived),
        password_iterations: iterations,
        password_algo: 'PBKDF2-SHA256'
    };
}

/** Constant-time string compare (prototype-grade parity check). */
function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) {
        diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return diff === 0;
}

/** Verifies a password against stored salt/hash fields. */
export async function verifyPassword(password, passwordSalt, passwordHash, iterations = DEFAULT_ITERATIONS) {
    if (!passwordSalt || !passwordHash) return false;
    try {
        const saltBytes = fromBase64(passwordSalt);
        const expected = fromBase64(passwordHash);
        const derived = await derive(password, saltBytes, iterations);
        const derivedBytes = new Uint8Array(derived);
        if (derivedBytes.length !== expected.length) return false;
        return safeEqual(
            Array.from(derivedBytes).join(','),
            Array.from(expected).join(',')
        );
    } catch {
        return false;
    }
}
