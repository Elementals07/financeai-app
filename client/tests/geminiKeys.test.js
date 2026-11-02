import test from 'node:test';
import assert from 'node:assert/strict';

import {
    GEMINI_KEYS_STORAGE_KEY,
    MAX_GEMINI_KEYS,
    clearGeminiKeys,
    getGeminiKeyCount,
    getGeminiKeyValidationError,
    loadGeminiKeys,
    maskGeminiKey,
    normalizeGeminiKey,
    normalizeGeminiKeys,
    saveGeminiKeys
} from '../src/services/geminiKeys.js';

function createMemoryStorage() {
    const values = new Map();

    return {
        getItem(key) {
            return values.has(key) ? values.get(key) : null;
        },
        setItem(key, value) {
            values.set(key, value);
        },
        removeItem(key) {
            values.delete(key);
        }
    };
}

test('normalizeGeminiKey trims keys and rejects invalid values', () => {
    assert.equal(normalizeGeminiKey('  AIzaSyTest_Key-123  '), 'AIzaSyTest_Key-123');
    assert.equal(normalizeGeminiKey(''), '');
    assert.equal(normalizeGeminiKey('key with spaces'), '');
    assert.equal(normalizeGeminiKey('https://example.com?key=AIzaSyTest'), '');
    assert.equal(normalizeGeminiKey(null), '');
});

test('getGeminiKeyValidationError only rejects non-Gemini key characters', () => {
    assert.equal(getGeminiKeyValidationError('AIzaSyTest_Key-123'), '');
    assert.equal(getGeminiKeyValidationError(''), '');
    assert.match(getGeminiKeyValidationError('AIza key'), /letters, numbers/);
});

test('normalizeGeminiKeys deduplicates and caps at five keys', () => {
    const keys = normalizeGeminiKeys([
        'key-1',
        ' key-2 ',
        'key-1',
        '',
        'key-3',
        'key-4',
        'key-5',
        'key-6'
    ]);

    assert.deepEqual(keys, ['key-1', 'key-2', 'key-3', 'key-4', 'key-5']);
    assert.equal(keys.length, MAX_GEMINI_KEYS);
});

test('saveGeminiKeys and loadGeminiKeys round-trip safely', () => {
    const storage = createMemoryStorage();

    const saved = saveGeminiKeys(['key-1', 'key-2', 'key-1', 'key-3'], storage);
    assert.deepEqual(saved, ['key-1', 'key-2', 'key-3']);
    assert.deepEqual(loadGeminiKeys(storage), ['key-1', 'key-2', 'key-3']);
    assert.equal(getGeminiKeyCount(storage), 3);
    assert.ok(storage.getItem(GEMINI_KEYS_STORAGE_KEY));
});

test('loadGeminiKeys ignores corrupt or non-array storage', () => {
    const storage = createMemoryStorage();

    storage.setItem(GEMINI_KEYS_STORAGE_KEY, '{not-json');
    assert.deepEqual(loadGeminiKeys(storage), []);

    storage.setItem(GEMINI_KEYS_STORAGE_KEY, JSON.stringify({ key: 'value' }));
    assert.deepEqual(loadGeminiKeys(storage), []);
});

test('clearGeminiKeys removes stored keys', () => {
    const storage = createMemoryStorage();
    saveGeminiKeys(['key-1'], storage);

    clearGeminiKeys(storage);

    assert.deepEqual(loadGeminiKeys(storage), []);
    assert.equal(getGeminiKeyCount(storage), 0);
});

test('maskGeminiKey does not expose the full key', () => {
    const key = 'AIzaSyTest_Key-1234567890';
    const masked = maskGeminiKey(key);

    assert.notEqual(masked, key);
    assert.match(masked, /^AIza\.\.\.7890$/);
    assert.equal(maskGeminiKey('short'), '********');
});
