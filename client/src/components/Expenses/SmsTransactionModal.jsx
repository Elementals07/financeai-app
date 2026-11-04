import { useMemo, useRef, useState } from 'react';
import {
    HiOutlineCheck,
    HiOutlineXMark,
    HiOutlineSparkles,
    HiOutlineCreditCard,
    HiOutlineCheckCircle,
    HiOutlineExclamationTriangle,
    HiOutlineTrash,
    HiOutlineArrowPath
} from 'react-icons/hi2';
import API from '../../api/axios';
import { useCategories } from '../../hooks/useCategories';
import toast from 'react-hot-toast';

const isValidDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');

const isValidItem = (item) => {
    const amount = parseFloat(item.amount);
    return Number.isFinite(amount) && amount > 0 && isValidDate(item.date) && Boolean(item.category);
};

const toEditableItems = (list) => (Array.isArray(list) ? list : []).map(item => ({
    ...item,
    amount: item.amount !== undefined && item.amount !== null ? String(item.amount) : '',
    _selected: !item.needsReview && Number(item.amount) > 0
}));

const SmsTransactionModal = ({ transactions = [], onClose, onSaved, onRefresh }) => {
    const { categoryNames } = useCategories();
    const [items, setItems] = useState(() => toEditableItems(transactions));
    const [saving, setSaving] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [savedCount, setSavedCount] = useState(0);
    const refreshInFlightRef = useRef(false);

    const selectedItems = useMemo(
        () => items.filter(item => item._selected && isValidItem(item)),
        [items]
    );
    const selectedTotal = selectedItems.reduce(
        (sum, item) => sum + (parseFloat(item.amount) || 0),
        0
    );
    const allSelected = items.length > 0 && items.every(item => item._selected);

    const resolveCategory = (value) => {
        if (categoryNames.includes(value)) return value;
        if (categoryNames.length > 0) return categoryNames[0];
        return value || 'Others';
    };

    const updateItem = (index, field, value) => {
        setItems(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], [field]: value };
            return updated;
        });
    };

    const toggleItem = (index) => {
        setItems(prev => {
            const updated = [...prev];
            updated[index] = { ...updated[index], _selected: !updated[index]._selected };
            return updated;
        });
    };

    const toggleAll = () => {
        const next = !allSelected;
        setItems(prev => prev.map(item => ({
            ...item,
            _selected: next && isValidItem(item)
        })));
    };

    const removeItem = (index) => {
        setItems(prev => prev.filter((_, i) => i !== index));
    };

    const importItems = async (list) => {
        const valid = list.filter(isValidItem);
        if (valid.length === 0) {
            toast.error('No valid transactions are selected');
            return;
        }

        setSaving(true);
        try {
            const payload = valid.map(item => ({
                smsId: item.smsId,
                amount: parseFloat(item.amount),
                category: resolveCategory(item.category),
                date: item.date,
                description: `${item.merchant || 'Bank SMS'} (via SMS)`,
                merchant: item.merchant || 'Bank SMS'
            }));

            const res = await API.post('/expenses/sms-import', { items: payload });
            const created = res.data?.data?.created?.length || 0;
            const skipped = res.data?.data?.skipped?.length || 0;

            if (created > 0) {
                toast.success(
                    `${created} transaction${created === 1 ? '' : 's'} imported${skipped > 0 ? `, ${skipped} already recorded` : ''}`
                );
            } else {
                toast('Those transactions were already imported.', { icon: 'ℹ️' });
            }

            setSavedCount(prev => prev + created);
            const importedIds = new Set(valid.map(item => item.smsId));
            setItems(prev => prev.filter(item => !importedIds.has(item.smsId)));
            if (onSaved) await onSaved();
        } catch (err) {
            toast.error(err?.message || 'Failed to import bank transactions');
        } finally {
            setSaving(false);
        }
    };

    const refreshResults = async () => {
        if (!onRefresh || refreshInFlightRef.current) return;
        refreshInFlightRef.current = true;
        setRefreshing(true);
        try {
            const fresh = await onRefresh();
            if (!Array.isArray(fresh)) {
                throw new Error('The AI returned an invalid SMS result.');
            }
            const nextItems = toEditableItems(fresh);
            setItems(nextItems);
            toast.success(
                nextItems.length > 0
                    ? 'SMS results refreshed from AI.'
                    : 'No debit transactions were found in these messages.'
            );
        } catch (err) {
            const reason = err?.message
                ? `${err.message} Previous results were kept.`
                : 'Could not refresh SMS results. Previous results were kept.';
            toast.error(reason);
        } finally {
            refreshInFlightRef.current = false;
            setRefreshing(false);
        }
    };

    if (items.length === 0) {
        return (
            <div className="modal-overlay" onClick={onClose} role="dialog">
                <div className="modal" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2 className="modal-title">Bank Messages Scan</h2>
                        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
                            <HiOutlineXMark aria-hidden="true" />
                        </button>
                    </div>
                    <div className="modal-body" style={{ textAlign: 'center', padding: '2.5rem 1.5rem' }}>
                        <div className="empty-state-icon" style={{ margin: '0 auto 1rem', width: '56px', height: '56px' }}>
                            <HiOutlineCheckCircle style={{ fontSize: '2rem', color: 'var(--color-success)' }} />
                        </div>
                        <h3>All Caught Up!</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                            {savedCount > 0
                                ? `Successfully recorded ${savedCount} transaction${savedCount === 1 ? '' : 's'} into your ledger.`
                                : 'No new untracked bank debits are waiting for review.'}
                        </p>
                    </div>
                    <div className="modal-footer">
                        <button type="button" className="btn btn-primary" onClick={onClose} style={{ width: '100%' }}>
                            Done
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="sms-review-title">
            <div className="modal" style={{ maxWidth: '640px', display: 'flex', flexDirection: 'column', maxHeight: '88vh', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase' }}>
                            <HiOutlineSparkles aria-hidden="true" />
                            AI Bank Tracker
                        </div>
                        <h2 id="sms-review-title" className="modal-title" style={{ fontSize: '1.2rem', marginTop: '2px' }}>
                            Review {items.length} Detected {items.length === 1 ? 'Debit' : 'Debits'}
                        </h2>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        {onRefresh && (
                            <button
                                type="button"
                                className="btn btn-outline btn-sm"
                                onClick={refreshResults}
                                disabled={saving || refreshing}
                                title="Re-run AI on these messages"
                                aria-label="Refresh SMS AI results"
                            >
                                <HiOutlineArrowPath
                                    className={refreshing ? 'spinner' : ''}
                                    aria-hidden="true"
                                />
                                <span>{refreshing ? 'Refreshing...' : 'Refresh'}</span>
                            </button>
                        )}
                        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
                            <HiOutlineXMark aria-hidden="true" />
                        </button>
                    </div>
                </div>

                {/* Selection summary */}
                <div style={{ flexShrink: 0, padding: '0.75rem 1.25rem', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-surface-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.8125rem', fontWeight: 600, cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={allSelected}
                            onChange={toggleAll}
                            style={{ width: '17px', height: '17px', accentColor: 'var(--color-primary)' }}
                        />
                        Select all valid
                    </label>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                        Selected: <strong>{selectedItems.length}</strong>
                        {' · '}
                        Total: <strong className="num" style={{ color: '#9B1C1C' }}>₹{selectedTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong>
                    </span>
                </div>

                {/* Modal Body */}
                <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {items.map((item, idx) => {
                            const valid = isValidItem(item);
                            return (
                                <div
                                    key={item.smsId || idx}
                                    style={{
                                        background: 'var(--bg-surface)',
                                        border: `1px solid ${item.needsReview ? 'var(--color-warning, #d97706)' : 'var(--border-color)'}`,
                                        borderRadius: 'var(--radius-md)',
                                        padding: '0.75rem 0.875rem'
                                    }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
                                        <input
                                            type="checkbox"
                                            checked={Boolean(item._selected)}
                                            onChange={() => toggleItem(idx)}
                                            disabled={!valid}
                                            aria-label={`Select transaction from ${item.merchant || 'unknown merchant'}`}
                                            style={{ width: '18px', height: '18px', marginTop: '0.35rem', accentColor: 'var(--color-primary)' }}
                                        />

                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                                                <input
                                                    type="text"
                                                    value={item.merchant || ''}
                                                    onChange={(e) => updateItem(idx, 'merchant', e.target.value)}
                                                    className="form-input"
                                                    placeholder="Merchant"
                                                    aria-label={`Merchant for transaction ${idx + 1}`}
                                                    style={{ flex: 1, minWidth: '150px', height: '34px', fontSize: '0.85rem', fontWeight: 700 }}
                                                />
                                                <div className="input-amount-wrapper" style={{ width: '120px' }}>
                                                    <span style={{ position: 'absolute', left: '8px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-secondary)' }}>₹</span>
                                                    <input
                                                        type="number"
                                                        step="any"
                                                        min="0.01"
                                                        value={item.amount}
                                                        onChange={(e) => updateItem(idx, 'amount', e.target.value)}
                                                        className="form-input num"
                                                        placeholder="Amount"
                                                        aria-label={`Amount for transaction ${idx + 1}`}
                                                        style={{ paddingLeft: '1.35rem', height: '34px', fontSize: '0.85rem', fontWeight: 700 }}
                                                    />
                                                </div>
                                                <button
                                                    type="button"
                                                    className="btn btn-outline btn-sm"
                                                    onClick={() => removeItem(idx)}
                                                    aria-label={`Remove transaction ${idx + 1}`}
                                                    style={{ minWidth: '34px', height: '34px', padding: 0, color: 'var(--color-danger)' }}
                                                >
                                                    <HiOutlineTrash aria-hidden="true" />
                                                </button>
                                            </div>

                                            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}>
                                                <select
                                                    value={resolveCategory(item.category)}
                                                    onChange={(e) => updateItem(idx, 'category', e.target.value)}
                                                    className="form-select"
                                                    aria-label={`Category for transaction ${idx + 1}`}
                                                    style={{ flex: 1.3, minWidth: '130px', height: '34px', fontSize: '0.8rem', padding: '0 6px' }}
                                                >
                                                    {categoryNames.map(c => (
                                                        <option key={c} value={c}>{c}</option>
                                                    ))}
                                                </select>
                                                <input
                                                    type="date"
                                                    value={item.date || ''}
                                                    onChange={(e) => updateItem(idx, 'date', e.target.value)}
                                                    className="form-input"
                                                    aria-label={`Date for transaction ${idx + 1}`}
                                                    style={{ flex: 1, minWidth: '130px', height: '34px', fontSize: '0.8rem' }}
                                                />
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.45rem', flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                                    <HiOutlineCreditCard aria-hidden="true" /> {item.source || 'Bank'}
                                                </span>
                                                {item.needsReview && (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-warning, #b45309)' }}>
                                                        <HiOutlineExclamationTriangle aria-hidden="true" /> Review needed
                                                    </span>
                                                )}
                                                {!valid && (
                                                    <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-danger)' }}>
                                                        Invalid amount or date
                                                    </span>
                                                )}
                                            </div>

                                            {item.rawText && (
                                                <div style={{
                                                    marginTop: '0.45rem',
                                                    fontSize: '0.72rem',
                                                    color: 'var(--text-muted)',
                                                    background: 'var(--bg-surface-subtle)',
                                                    padding: '0.35rem 0.5rem',
                                                    borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid var(--border-color)',
                                                    lineHeight: 1.35,
                                                    wordBreak: 'break-word'
                                                }}>
                                                    &ldquo;{item.rawText}&rdquo;
                                                </div>
                                            )}
                                        </div>

                                        <button
                                            type="button"
                                            className="btn btn-primary btn-sm"
                                            onClick={() => importItems([item])}
                                            disabled={saving || !valid}
                                            title="Approve this transaction"
                                            style={{ minWidth: '36px', height: '36px', padding: 0, flexShrink: 0 }}
                                        >
                                            <HiOutlineCheck aria-hidden="true" />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Sticky Footer */}
                <div className="modal-footer" style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>
                        Review Later
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => importItems(selectedItems)}
                        disabled={saving || selectedItems.length === 0}
                        style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }}
                    >
                        <HiOutlineCheckCircle aria-hidden="true" />
                        <span>{saving ? 'Saving...' : `Approve Selected (${selectedItems.length})`}</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SmsTransactionModal;
