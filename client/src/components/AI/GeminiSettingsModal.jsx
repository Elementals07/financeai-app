import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
    HiOutlineEye,
    HiOutlineEyeSlash,
    HiOutlineKey,
    HiOutlineShieldCheck,
    HiOutlineSparkles,
    HiOutlineXMark,
    HiOutlineCheckCircle,
    HiOutlineExclamationTriangle
} from 'react-icons/hi2';
import {
    MAX_GEMINI_KEYS,
    clearGeminiKeys,
    getGeminiKeyValidationError,
    loadGeminiKeys,
    normalizeGeminiKeys,
    saveGeminiKeys
} from '../../services/geminiKeys';
import {
    AI_PROVIDERS,
    AI_PROVIDER_LABELS
} from '../../services/ai/aiConfig';
import {
    clearVelonaKey,
    getAIProviderStatus,
    getVelonaKeyValidationError,
    saveVelonaKey,
    setAIProviderPreference,
    setGeminiEnabled,
    setVelonaEnabled,
    emitAIProviderSettingsChanged
} from '../../services/ai/providerSettings';

const emptyInputs = () => Array.from({ length: MAX_GEMINI_KEYS }, () => '');

const PROVIDER_OPTIONS = [
    {
        id: AI_PROVIDERS.VELONA,
        label: 'Velona',
        description: 'Recommended default. Fast, low-cost analysis, chat, receipts and SMS parsing.'
    },
    {
        id: AI_PROVIDERS.GEMINI,
        label: 'Google Gemini',
        description: 'Required for Live Voice. Also supports analysis, chat and receipt scanning.'
    }
];

const statusPill = (configured, enabled) => {
    if (!enabled) {
        return { text: 'Turned off', color: 'var(--color-danger)', background: 'var(--color-danger-subtle, #FEF2F2)' };
    }
    if (!configured) {
        return { text: 'No key saved', color: 'var(--text-muted)', background: 'var(--bg-surface-subtle)' };
    }
    return { text: 'Ready', color: 'var(--color-success, #047857)', background: 'var(--color-success-subtle, #ECFDF5)' };
};

const GeminiSettingsModal = ({ onClose, onChanged }) => {
    const [geminiInputs, setGeminiInputs] = useState(() => {
        const stored = loadGeminiKeys();
        return emptyInputs().map((_, index) => stored[index] || '');
    });
    const [velonaDraft, setVelonaDraft] = useState('');
    const [showGeminiKeys, setShowGeminiKeys] = useState(false);
    const [showVelonaKey, setShowVelonaKey] = useState(false);
    const [savingGemini, setSavingGemini] = useState(false);
    const [savingVelona, setSavingVelona] = useState(false);
    const [status, setStatus] = useState(() => getAIProviderStatus());

    const geminiConfiguredCount = useMemo(
        () => normalizeGeminiKeys(geminiInputs).length,
        [geminiInputs]
    );

    const selectedProvider = status.preference || status.activeProvider;

    const refreshStatus = () => {
        const next = getAIProviderStatus();
        setStatus(next);
        onChanged?.(next);
        return next;
    };

    useEffect(() => {
        const handleKeyDown = (event) => {
            if (event.key === 'Escape') onClose();
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const updateGeminiInput = (index, value) => {
        setGeminiInputs(prev => prev.map((item, itemIndex) => (
            itemIndex === index ? value : item
        )));
    };

    const handleGeminiPaste = (index, event) => {
        const pastedKeys = event.clipboardData
            .getData('text')
            .split(/\r?\n|,/)
            .map(value => value.trim())
            .filter(Boolean);

        if (pastedKeys.length <= 1) return;

        event.preventDefault();
        setGeminiInputs(prev => {
            const next = [...prev];
            for (let offset = 0; offset < pastedKeys.length && index + offset < MAX_GEMINI_KEYS; offset++) {
                next[index + offset] = pastedKeys[offset];
            }
            return next;
        });
    };

    const handleSaveVelona = () => {
        const validationError = getVelonaKeyValidationError(velonaDraft);
        if (validationError) {
            toast.error(validationError);
            return;
        }

        setSavingVelona(true);
        try {
            saveVelonaKey(velonaDraft);
            setVelonaDraft('');
            refreshStatus();
            toast.success('Velona API key saved on this device.');
        } catch (error) {
            toast.error(error.message || 'Could not save the Velona API key.');
        } finally {
            setSavingVelona(false);
        }
    };

    const handleRemoveVelona = () => {
        if (!window.confirm('Remove the Velona API key from this device?')) return;

        setSavingVelona(true);
        try {
            clearVelonaKey();
            refreshStatus();
            toast.success('Velona API key removed.');
        } catch (error) {
            toast.error(error.message || 'Could not remove the Velona API key.');
        } finally {
            setSavingVelona(false);
        }
    };

    const handleSaveGemini = () => {
        const trimmedInputs = geminiInputs.map(value => value.trim());
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

        setSavingGemini(true);
        try {
            const saved = saveGeminiKeys(keys);
            // Saving keys signals intent to use Gemini. Keep the explicit
            // toggle as the source of truth after that.
            if (saved.length > 0) setGeminiEnabled(true);
            emitAIProviderSettingsChanged();
            refreshStatus();
            toast.success(saved.length
                ? `Saved ${saved.length} Gemini key${saved.length === 1 ? '' : 's'} on this device.`
                : 'Gemini keys cleared.');
        } catch (error) {
            toast.error(error.message || 'Could not save Gemini keys.');
        } finally {
            setSavingGemini(false);
        }
    };

    const handleClearGemini = () => {
        if (!window.confirm('Remove all Gemini API keys from this device?')) return;

        setSavingGemini(true);
        try {
            clearGeminiKeys();
            setGeminiInputs(emptyInputs());
            emitAIProviderSettingsChanged();
            refreshStatus();
            toast.success('Gemini keys removed.');
        } catch (error) {
            toast.error(error.message || 'Could not remove Gemini keys.');
        } finally {
            setSavingGemini(false);
        }
    };

    const handleToggleVelona = (enabled) => {
        if (!enabled && status.activeProvider === AI_PROVIDERS.VELONA) {
            const confirmed = window.confirm(
                'Velona is your active provider. Turning it off will make AI requests fail until you choose another provider. Continue?'
            );
            if (!confirmed) return;
        }
        setVelonaEnabled(enabled);
        refreshStatus();
        toast.success(enabled ? 'Velona enabled.' : 'Velona turned off.');
    };

    const handleToggleGemini = (enabled) => {
        if (!enabled && status.activeProvider === AI_PROVIDERS.GEMINI) {
            const confirmed = window.confirm(
                'Google Gemini is your active provider. Turning it off will make AI requests fail until you choose another provider. Continue?'
            );
            if (!confirmed) return;
        }
        setGeminiEnabled(enabled);
        refreshStatus();
        toast.success(enabled ? 'Google Gemini enabled.' : 'Google Gemini turned off.');
    };

    const handleChooseProvider = (provider) => {
        const info = status[provider];
        const label = AI_PROVIDER_LABELS[provider];

        if (!info.enabled) {
            toast.error(`${label} is turned off. Enable it first.`);
            return;
        }
        if (!info.configured) {
            toast.error(`${label} has no API key saved. Add a key first.`);
            return;
        }

        if (status.activeProvider && status.activeProvider !== provider) {
            const confirmed = window.confirm(
                `Switch to ${label}? Future AI requests will use ${label}.`
            );
            if (!confirmed) return;
        }

        try {
            setAIProviderPreference(provider);
            refreshStatus();
            toast.success(`Active provider: ${label}`);
        } catch (error) {
            toast.error(error.message || 'Could not change the active provider.');
        }
    };

    const velonaPill = statusPill(status.velona.configured, status.velona.enabled);
    const geminiPill = statusPill(status.gemini.configured, status.gemini.enabled);
    const activeLabel = status.activeProviderLabel;

    return (
        <div
            className="modal-overlay"
            onClick={onClose}
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-settings-title"
        >
            <div
                className="modal"
                onClick={(event) => event.stopPropagation()}
                style={{ maxWidth: '620px', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
            >
                <div className="modal-header">
                    <div>
                        <h2 id="ai-settings-title" className="modal-title" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                            <HiOutlineSparkles style={{ color: 'var(--color-primary)' }} />
                            AI Settings
                        </h2>
                        <p style={{ margin: '0.25rem 0 0', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            Choose your AI provider and manage device-local API keys.
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

                <div className="modal-body" style={{ overflowY: 'auto', minHeight: 0 }}>
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
                        <p style={{ margin: 0, fontSize: '0.83rem', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            Keys are stored only in this device's local storage. AI requests go directly from this device to the selected provider. Nothing is sent to our servers.
                        </p>
                    </div>

                    {/* Active provider */}
                    <div
                        style={{
                            padding: '0.85rem',
                            borderRadius: 'var(--radius-sm)',
                            border: '1px solid var(--border-color)',
                            backgroundColor: status.activeProvider ? 'var(--color-primary-subtle)' : 'var(--bg-surface-subtle)',
                            marginBottom: '1rem'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                            {status.activeProvider ? (
                                <HiOutlineCheckCircle
                                    aria-hidden="true"
                                    style={{ color: 'var(--color-success, #047857)', fontSize: '1.15rem' }}
                                />
                            ) : (
                                <HiOutlineExclamationTriangle
                                    aria-hidden="true"
                                    style={{ color: 'var(--color-danger)', fontSize: '1.15rem' }}
                                />
                            )}
                            <strong style={{ fontSize: '0.9rem' }}>
                                Active provider: {activeLabel || 'Not configured'}
                            </strong>
                        </div>
                        {status.unavailableMessage && (
                            <p style={{ margin: '0 0 0.65rem', fontSize: '0.82rem', color: 'var(--color-danger)' }}>
                                {status.unavailableMessage}
                            </p>
                        )}
                        <div role="radiogroup" aria-label="Active AI provider" style={{ display: 'grid', gap: '0.5rem' }}>
                            {PROVIDER_OPTIONS.map(option => {
                                const info = status[option.id];
                                const selected = selectedProvider === option.id;
                                const unavailable = !info.enabled || !info.configured;
                                return (
                                    <label
                                        key={option.id}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '0.55rem',
                                            padding: '0.6rem 0.7rem',
                                            borderRadius: 'var(--radius-sm)',
                                            border: selected
                                                ? '1px solid var(--color-primary)'
                                                : '1px solid var(--border-color)',
                                            backgroundColor: selected ? 'var(--bg-surface)' : 'transparent',
                                            cursor: unavailable ? 'not-allowed' : 'pointer',
                                            opacity: unavailable && !selected ? 0.7 : 1
                                        }}
                                    >
                                        <input
                                            type="radio"
                                            name="active-ai-provider"
                                            value={option.id}
                                            checked={selected}
                                            onChange={() => handleChooseProvider(option.id)}
                                            disabled={unavailable}
                                            style={{ marginTop: '0.2rem' }}
                                        />
                                        <span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontWeight: 600, fontSize: '0.86rem' }}>
                                                {option.label}
                                                <span
                                                    style={{
                                                        fontSize: '0.68rem',
                                                        fontWeight: 600,
                                                        color: statusPill(info.configured, info.enabled).color,
                                                        backgroundColor: statusPill(info.configured, info.enabled).background,
                                                        padding: '0.05rem 0.35rem',
                                                        borderRadius: 'var(--radius-full)'
                                                    }}
                                                >
                                                    {statusPill(info.configured, info.enabled).text}
                                                </span>
                                            </span>
                                            <span style={{ display: 'block', fontSize: '0.76rem', color: 'var(--text-secondary)', marginTop: '0.15rem' }}>
                                                {option.description}
                                            </span>
                                        </span>
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    {/* Velona */}
                    <section
                        aria-labelledby="velona-settings-title"
                        style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '0.85rem',
                            marginBottom: '1rem'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.65rem' }}>
                            <div>
                                <h3 id="velona-settings-title" style={{ margin: 0, fontSize: '0.95rem' }}>
                                    Velona
                                </h3>
                                <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                    Model: qwen/qwen3.7-flash
                                </p>
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', fontWeight: 600 }}>
                                <input
                                    type="checkbox"
                                    checked={status.velona.enabled}
                                    onChange={(event) => handleToggleVelona(event.target.checked)}
                                />
                                Enabled
                            </label>
                        </div>

                        {status.velona.configured ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                    Saved key: <code>{status.velona.keyMasked}</code>
                                </span>
                                <span
                                    style={{
                                        fontSize: '0.7rem',
                                        fontWeight: 600,
                                        color: velonaPill.color,
                                        backgroundColor: velonaPill.background,
                                        padding: '0.05rem 0.35rem',
                                        borderRadius: 'var(--radius-full)'
                                    }}
                                >
                                    {velonaPill.text}
                                </span>
                            </div>
                        ) : (
                            <p style={{ margin: '0 0 0.5rem', fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                                No Velona key saved yet.
                            </p>
                        )}

                        <div className="form-group" style={{ marginTop: '0.6rem', marginBottom: 0 }}>
                            <label className="form-label" htmlFor="velona-api-key">
                                <HiOutlineKey aria-hidden="true" style={{ marginRight: '0.35rem', verticalAlign: '-0.15rem' }} />
                                {status.velona.configured ? 'Replace Velona API key' : 'Velona API key'}
                            </label>
                            <input
                                id="velona-api-key"
                                className="form-input"
                                type={showVelonaKey ? 'text' : 'password'}
                                value={velonaDraft}
                                onChange={(event) => setVelonaDraft(event.target.value)}
                                placeholder={status.velona.configured ? 'Paste a new key to replace the saved key' : 'Paste your Velona API key'}
                                autoComplete="off"
                                autoCapitalize="none"
                                autoCorrect="off"
                                spellCheck={false}
                                style={{ fontFamily: 'monospace' }}
                            />
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', marginTop: '0.6rem', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={() => setShowVelonaKey(visible => !visible)}
                            >
                                {showVelonaKey ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
                                {showVelonaKey ? 'Hide key' : 'Show key'}
                            </button>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                {status.velona.configured && (
                                    <button
                                        type="button"
                                        className="btn btn-danger-outline btn-sm"
                                        onClick={handleRemoveVelona}
                                        disabled={savingVelona}
                                    >
                                        Remove key
                                    </button>
                                )}
                                <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={handleSaveVelona}
                                    disabled={savingVelona || !velonaDraft.trim()}
                                >
                                    {savingVelona ? 'Saving...' : 'Save Velona key'}
                                </button>
                            </div>
                        </div>
                    </section>

                    {/* Gemini */}
                    <section
                        aria-labelledby="gemini-settings-title"
                        style={{
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-sm)',
                            padding: '0.85rem'
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.65rem' }}>
                            <div>
                                <h3 id="gemini-settings-title" style={{ margin: 0, fontSize: '0.95rem' }}>
                                    Google Gemini
                                </h3>
                                <p style={{ margin: '0.2rem 0 0', fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                                    Required for Live Voice. Add up to {MAX_GEMINI_KEYS} keys for rotation.
                                </p>
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', fontSize: '0.82rem', fontWeight: 600 }}>
                                <input
                                    type="checkbox"
                                    checked={status.gemini.enabled}
                                    onChange={(event) => handleToggleGemini(event.target.checked)}
                                />
                                Enabled
                            </label>
                        </div>

                        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                            <label className="form-label" htmlFor="gemini-key-1">
                                <HiOutlineKey aria-hidden="true" style={{ marginRight: '0.35rem', verticalAlign: '-0.15rem' }} />
                                Gemini API Keys
                            </label>
                            {geminiInputs.map((value, index) => (
                                <input
                                    key={index}
                                    id={`gemini-key-${index + 1}`}
                                    className="form-input"
                                    type={showGeminiKeys ? 'text' : 'password'}
                                    value={value}
                                    onChange={(event) => updateGeminiInput(index, event.target.value)}
                                    onPaste={(event) => handleGeminiPaste(index, event)}
                                    placeholder={index === 0 ? 'Primary Gemini API Key (e.g. AIza...)' : `Fallback Key ${index + 1} (optional)`}
                                    autoComplete="off"
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck={false}
                                    style={{ marginBottom: '0.5rem', fontFamily: 'monospace' }}
                                />
                            ))}
                            <p style={{ margin: '0.25rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                Paste raw Gemini API keys only. You can paste multiple keys separated by newlines.
                            </p>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.6rem', flexWrap: 'wrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                                <button
                                    type="button"
                                    className="btn btn-outline btn-sm"
                                    onClick={() => setShowGeminiKeys(visible => !visible)}
                                >
                                    {showGeminiKeys ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
                                    {showGeminiKeys ? 'Hide keys' : 'Show keys'}
                                </button>
                                <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                                    {geminiConfiguredCount}/{MAX_GEMINI_KEYS} configured
                                    {status.gemini.keyCount > geminiConfiguredCount
                                        ? ` · ${status.gemini.keyCount} available`
                                        : ''}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: '0.5rem' }}>
                                <button
                                    type="button"
                                    className="btn btn-danger-outline btn-sm"
                                    onClick={handleClearGemini}
                                    disabled={savingGemini || status.gemini.keyCount === 0}
                                >
                                    Remove all
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary btn-sm"
                                    onClick={handleSaveGemini}
                                    disabled={savingGemini}
                                >
                                    {savingGemini ? 'Saving...' : 'Save Gemini keys'}
                                </button>
                            </div>
                        </div>
                    </section>
                </div>

                <div className="modal-footer" style={{ justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-primary" onClick={onClose}>
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GeminiSettingsModal;
