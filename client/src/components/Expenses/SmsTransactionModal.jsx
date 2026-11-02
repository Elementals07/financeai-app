import { useState } from 'react';
import { 
    HiOutlineCheck, 
    HiOutlineXMark, 
    HiOutlineSparkles, 
    HiOutlineCreditCard,
    HiOutlineChevronRight,
    HiOutlineViewColumns,
    HiOutlineListBullet,
    HiOutlineCheckCircle
} from 'react-icons/hi2';
import API from '../../api/axios';
import { useCategories } from '../../hooks/useCategories';
import smsService from '../../services/smsService';
import toast from 'react-hot-toast';

const SmsTransactionModal = ({ transactions = [], onClose, onSaved }) => {
    const { categoryNames, colorMap } = useCategories();
    const [items, setItems] = useState(transactions);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [viewMode, setViewMode] = useState('card'); // 'card' or 'list'
    const [saving, setSaving] = useState(false);
    const [savedCount, setSavedCount] = useState(0);

    if (items.length === 0) {
        return (
            <div className="modal-overlay" onClick={onClose} role="dialog">
                <div className="modal" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
                    <div className="modal-header">
                        <h2 className="modal-title">Bank Messages Scan</h2>
                        <button type="button" className="modal-close-btn" onClick={onClose}>
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
                                ? `Successfully recorded ${savedCount} transactions into your ledger.`
                                : 'No new untracked bank debits were found in your recent messages.'}
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

    const currentItem = items[currentIndex] || items[0];

    const handleUpdateItem = (idx, field, value) => {
        const updated = [...items];
        updated[idx] = { ...updated[idx], [field]: value };
        setItems(updated);
    };

    // Approve a single transaction
    const handleApproveCurrent = async (itemToSave, indexToRemove) => {
        setSaving(true);
        try {
            await API.post('/expenses', {
                amount: parseFloat(itemToSave.amount),
                category: itemToSave.category || categoryNames[0] || 'Others',
                date: itemToSave.date || new Date().toISOString().slice(0, 10),
                description: `${itemToSave.merchant} (via SMS)`
            });

            smsService.markProcessed(itemToSave.id);
            toast.success(`Saved ₹${itemToSave.amount} for ${itemToSave.merchant}`);
            setSavedCount(prev => prev + 1);

            // Remove from list
            const remaining = items.filter((_, i) => i !== indexToRemove);
            setItems(remaining);
            if (currentIndex >= remaining.length) {
                setCurrentIndex(Math.max(0, remaining.length - 1));
            }
            if (onSaved) onSaved();
        } catch (err) {
            toast.error('Failed to save transaction');
        } finally {
            setSaving(false);
        }
    };

    // Skip a transaction without saving
    const handleSkipCurrent = (itemToSkip, indexToRemove) => {
        smsService.markProcessed(itemToSkip.id);
        const remaining = items.filter((_, i) => i !== indexToRemove);
        setItems(remaining);
        if (currentIndex >= remaining.length) {
            setCurrentIndex(Math.max(0, remaining.length - 1));
        }
    };

    // Approve all remaining
    const handleApproveAll = async () => {
        setSaving(true);
        try {
            const batchPayload = items.map(it => ({
                amount: parseFloat(it.amount),
                category: it.category || categoryNames[0] || 'Others',
                date: it.date || new Date().toISOString().slice(0, 10),
                description: `${it.merchant} (via SMS)`
            }));

            await API.post('/expenses/batch', { items: batchPayload });
            items.forEach(it => smsService.markProcessed(it.id));

            toast.success(`Recorded all ${items.length} transactions!`);
            setSavedCount(prev => prev + items.length);
            setItems([]);
            if (onSaved) onSaved();
        } catch (err) {
            toast.error('Failed to save all transactions');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
            <div className="modal" style={{ maxWidth: '540px', display: 'flex', flexDirection: 'column', maxHeight: '88vh', overflow: 'hidden' }} onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="modal-header" style={{ flexShrink: 0 }}>
                    <div>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase' }}>
                            <HiOutlineSparkles aria-hidden="true" />
                            AI Bank Tracker
                        </div>
                        <h2 className="modal-title" style={{ fontSize: '1.2rem', marginTop: '2px' }}>
                            {items.length} Untracked {items.length === 1 ? 'Debit' : 'Debits'} Found
                        </h2>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {/* Toggle Card vs List view */}
                        <button
                            type="button"
                            className="btn btn-outline btn-sm"
                            onClick={() => setViewMode(v => v === 'card' ? 'list' : 'card')}
                            title={viewMode === 'card' ? 'Switch to List' : 'Switch to Cards'}
                            style={{ minWidth: '36px', height: '36px', padding: '0 8px', fontSize: '0.8rem' }}
                        >
                            {viewMode === 'card' ? <HiOutlineListBullet /> : <HiOutlineViewColumns />}
                        </button>

                        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close dialog">
                            <HiOutlineXMark aria-hidden="true" />
                        </button>
                    </div>
                </div>

                {/* Modal Body */}
                <div className="modal-body" style={{ flex: 1, overflowY: 'auto', padding: '1rem 1.25rem' }}>
                    {viewMode === 'card' ? (
                        /* A. Swipeable Card Stack View (One by One) */
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                            {/* Counter Pill */}
                            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '2px 10px', borderRadius: 'var(--radius-full)', background: 'var(--bg-surface-subtle)', border: '1px solid var(--border-color)', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
                                Card {currentIndex + 1} of {items.length}
                            </div>

                            {/* Active Transaction Card */}
                            <div style={{
                                width: '100%',
                                background: 'linear-gradient(135deg, #FFFFFF 0%, #F5F7FF 100%)',
                                border: '1.5px solid var(--color-primary-subtle)',
                                borderTop: '4px solid var(--color-primary)',
                                borderRadius: 'var(--radius-lg)',
                                padding: '1.25rem',
                                boxShadow: '0 8px 24px rgba(45, 63, 191, 0.08)',
                                marginBottom: '1rem',
                                position: 'relative'
                            }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                    <div>
                                        <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: 700 }}>
                                            Payee / Merchant
                                        </span>
                                        <div style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--text-primary)', marginTop: '2px' }}>
                                            {currentItem.merchant || 'Unknown Merchant'}
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                        <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', fontWeight: 700 }}>
                                            Amount
                                        </span>
                                        <div className="num" style={{ fontSize: '1.6rem', fontWeight: 800, color: '#9B1C1C', marginTop: '2px' }}>
                                            ₹{parseFloat(currentItem.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                        </div>
                                    </div>
                                </div>

                                {/* Category Selector Pill & Date */}
                                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
                                    <div style={{ flex: 1.5 }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                            AI Category (Tap to change)
                                        </label>
                                        <select
                                            value={currentItem.category || (categoryNames[0] || 'Others')}
                                            onChange={(e) => handleUpdateItem(currentIndex, 'category', e.target.value)}
                                            className="form-select"
                                            style={{ height: '38px', fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-primary)' }}
                                        >
                                            {categoryNames.map(c => (
                                                <option key={c} value={c}>{c}</option>
                                            ))}
                                        </select>
                                    </div>

                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-secondary)', marginBottom: '4px' }}>
                                            Date
                                        </label>
                                        <input
                                            type="date"
                                            value={currentItem.date}
                                            onChange={(e) => handleUpdateItem(currentIndex, 'date', e.target.value)}
                                            className="form-input"
                                            style={{ height: '38px', fontSize: '0.8rem' }}
                                        />
                                    </div>
                                </div>

                                {/* SMS Snippet */}
                                {currentItem.rawText && (
                                    <div style={{
                                        fontSize: '0.75rem',
                                        color: 'var(--text-muted)',
                                        background: 'var(--bg-surface-subtle)',
                                        padding: '0.5rem 0.75rem',
                                        borderRadius: 'var(--radius-sm)',
                                        border: '1px solid var(--border-color)',
                                        fontFamily: 'var(--font-family-mono)',
                                        lineHeight: 1.35
                                    }}>
                                        &ldquo;{currentItem.rawText}&rdquo;
                                    </div>
                                )}
                            </div>

                            {/* One-by-One Action Buttons */}
                            <div style={{ display: 'flex', gap: '0.75rem', width: '100%' }}>
                                <button
                                    type="button"
                                    className="btn btn-outline"
                                    onClick={() => handleSkipCurrent(currentItem, currentIndex)}
                                    disabled={saving}
                                    style={{ flex: 1, minHeight: '44px', color: 'var(--text-secondary)' }}
                                >
                                    <HiOutlineXMark aria-hidden="true" />
                                    <span>Skip</span>
                                </button>
                                <button
                                    type="button"
                                    className="btn btn-primary"
                                    onClick={() => handleApproveCurrent(currentItem, currentIndex)}
                                    disabled={saving}
                                    style={{ flex: 1.6, minHeight: '44px' }}
                                >
                                    <HiOutlineCheck aria-hidden="true" />
                                    <span>Approve & Add</span>
                                </button>
                            </div>
                        </div>
                    ) : (
                        /* B. List View of All Transactions */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                            {items.map((item, idx) => (
                                <div key={item.id || idx} style={{
                                    background: 'var(--bg-surface)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: '0.75rem 1rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '0.75rem'
                                }}>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>
                                                {item.merchant}
                                            </span>
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                {item.date}
                                            </span>
                                        </div>
                                        <div style={{ marginTop: '4px' }}>
                                            <select
                                                value={item.category}
                                                onChange={(e) => handleUpdateItem(idx, 'category', e.target.value)}
                                                className="form-select"
                                                style={{ height: '30px', fontSize: '0.75rem', padding: '0 6px', width: 'auto', minWidth: '110px' }}
                                            >
                                                {categoryNames.map(c => (
                                                    <option key={c} value={c}>{c}</option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                                        <div className="num" style={{ fontWeight: 800, fontSize: '1rem', color: '#9B1C1C' }}>
                                            ₹{parseFloat(item.amount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-outline btn-sm"
                                            onClick={() => handleSkipCurrent(item, idx)}
                                            style={{ minWidth: '32px', height: '32px', padding: 0 }}
                                            title="Skip"
                                        >
                                            <HiOutlineXMark />
                                        </button>
                                        <button
                                            type="button"
                                            className="btn btn-primary btn-sm"
                                            onClick={() => handleApproveCurrent(item, idx)}
                                            style={{ minWidth: '32px', height: '32px', padding: 0 }}
                                            title="Approve"
                                        >
                                            <HiOutlineCheck />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Sticky Footer */}
                <div className="modal-footer" style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <button type="button" className="btn btn-outline btn-sm" onClick={onClose} disabled={saving}>
                        Review Later
                    </button>
                    <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={handleApproveAll}
                        disabled={saving}
                        style={{ background: 'linear-gradient(135deg, var(--color-primary), var(--color-accent))' }}
                    >
                        <HiOutlineCheckCircle aria-hidden="true" />
                        <span>Approve All ({items.length})</span>
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SmsTransactionModal;
