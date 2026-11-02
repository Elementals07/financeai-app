import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
    HiOutlineEye,
    HiOutlineEyeSlash,
    HiOutlineKey,
    HiOutlineShieldCheck,
    HiOutlineXMark
} from 'react-icons/hi2';
import {
    MAX_GEMINI_KEYS,
    clearGeminiKeys,
    getGeminiKeyValidationError,
    loadGeminiKeys,
    normalizeGeminiKeys,
    saveGeminiKeys
} from '../../services/geminiKeys';

const emptyInputs = () => Array.from({ length: MAX_GEMINI_KEYS }, () => '');

const GeminiSettingsModal = ({ onClose, onSaved }) => {
    const [inputs, setInputs] = useState(() => {
        const stored = loadGeminiKeys();
        return emptyInputs().map((_, index) => stored[index] || '');
    });
    const [showKeys, setShowKeys] = useState(false);
    const [saving, setSaving] = useState(false);

    const configuredCount = useMemo(() => normalizeGeminiKeys(inputs).length, [inputs]);

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const updateInput = (index, value) => {
        setInputs(prev => prev.map((item, itemIndex) => (
            itemIndex === index ? value : item
        )));
    };

    const handlePaste = (index, event) => {
        const pastedKeys = event.clipboardData
            .getData('text')
            .split(/\r?\n|,/)
            .map(value => value.trim())
            .filter(Boolean);

        if (pastedKeys.length <= 1) return;

        event.preventDefault();
        setInputs(prev => {
            const next = [...prev];
            for (let offset = 0; offset < pastedKeys.length && index + offset < MAX_GEMINI_KEYS; offset++) {
                next[index + offset] = pastedKeys[offset];
            }
            return next;
        });
    };

    const handleSave = () => {
        const trimmedInputs = inputs.map(value => value.trim());
        const validationError = trimmedInputs
            .map(getGeminiKeyValidationError)
            .find(Boolean);

        if (validationError) {
            toast.error(validationError);
            return;
        }

        const keys = normalizeGeminiKeys(trimmedInputs);
        const enteredCount = trimmedInputs.filter(Boolean).length;

        if (keys.length !== enteredCount) {
            toast.error('Duplicate keys are not allowed.');
            return;
        }

        setSaving(true);
        try {
            const saved = saveGeminiKeys(keys);
            onSaved?.(saved);
            toast.success(saved.length ? `Saved ${saved.length} Gemini key${saved.length === 1 ? '' : 's'}.` : 'Gemini keys cleared.');
            onClose();
        } catch (error) {
            toast.error(error.message || 'Could not save Gemini keys.');
        } finally {
            setSaving(false);
        }
    };

    const handleClear = () => {
        setSaving(true);
        try {
            clearGeminiKeys();
            setInputs(emptyInputs());
            onSaved?.([]);
            toast.success('Gemini keys removed from this device.');
            onClose();
        } catch (error) {
            toast.error(error.message || 'Could not remove Gemini keys.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div
            className="modal-overlay"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="gemini-settings-title"
        >
            <div className="modal" onClick={(event) => event.stopPropagation()}>
                <div className="modal-header">
                    <div>
                        <h2 id="gemini-settings-title" className="modal-title">AI Settings</h2>
                        <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            Add your own Gemini API keys for AI features.
                        </p>
                    </div>
                    <button
                        type="button"
                        className="modal-close-btn"
                        onClick={onClose}
                        aria-label="Close AI settings"
                    >
                        <HiOutlineXMark aria-hidden="true" />
                    </button>
                </div>

                <div className="modal-body">
                    <div
                        style={{
                            display: 'flex',
                            gap: '0.65rem',
                            padding: '0.75rem',
                            borderRadius: 'var(--radius-sm)',
                            backgroundColor: 'var(--bg-surface-subtle)',
                            border: '1px solid var(--border-color)',
                            marginBottom: '1rem'
                        }}
                    >
                        <HiOutlineShieldCheck
                            aria-hidden="true"
                            style={{
                                fontSize: '1.25rem',
                                color: 'var(--color-primary)',
                                flexShrink: 0,
                                marginTop: '0.1rem'
                            }}
                        />
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            Keys are stored in this browser's local storage, which FinanceAI does not encrypt. AI requests
                            send your financial context directly to Google Gemini. Do not save keys on a shared device.
                            Add up to {MAX_GEMINI_KEYS} keys for automatic rotation.
                        </p>
                    </div>

                    <div className="form-group">
                        <label className="form-label" htmlFor="gemini-key-1">
                            <HiOutlineKey aria-hidden="true" style={{ marginRight: '0.35rem', verticalAlign: '-0.15rem' }} />
                            Gemini API keys
                        </label>
                        {inputs.map((value, index) => (
                            <input
                                key={index}
                                id={`gemini-key-${index + 1}`}
                                className="form-input"
                                type={showKeys ? 'text' : 'password'}
                                value={value}
                                onChange={(event) => updateInput(index, event.target.value)}
                                onPaste={(event) => handlePaste(index, event)}
                                placeholder={`Gemini key ${index + 1}`}
                                autoComplete="off"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                style={{ marginBottom: '0.5rem', fontFamily: 'monospace' }}
                            />
                        ))}
                        <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                            Paste raw Gemini API keys only, not full URLs. You can paste multiple keys at once.
                        </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem' }}>
                        <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => setShowKeys(visible => !visible)}
                        >
                            {showKeys ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
                            {showKeys ? 'Hide keys' : 'Show keys'}
                        </button>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {configuredCount}/{MAX_GEMINI_KEYS} configured
                        </span>
                    </div>
                </div>

                <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
                    <button
                        type="button"
                        className="btn btn-danger-outline"
                        onClick={handleClear}
                        disabled={saving || configuredCount === 0}
                    >
                        Remove all
                    </button>
                    <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                        <button type="button" className="btn btn-outline" onClick={onClose} disabled={saving}>
                            Cancel
                        </button>
                        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                            {saving ? 'Saving...' : 'Save keys'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default GeminiSettingsModal;
