import { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { HiOutlineCheck, HiOutlineXMark, HiOutlineTag } from 'react-icons/hi2';
import { useCategories } from '../../hooks/useCategories';

const ExpenseForm = ({ onSubmit, onClose, editData = null }) => {
    const { categoryNames } = useCategories();
    const [amount, setAmount] = useState(editData ? String(editData.amount) : '');
    const [category, setCategory] = useState(editData?.category || (categoryNames[0] || 'Food'));
    const [date, setDate] = useState(editData?.date?.slice(0, 10) || new Date().toISOString().slice(0, 10));
    const [description, setDescription] = useState(editData?.description || '');
    const [loading, setLoading] = useState(false);

    // Ensure category is set if categoryNames load after mount
    useEffect(() => {
        if (!editData && categoryNames.length > 0 && !categoryNames.includes(category)) {
            setCategory(categoryNames[0]);
        }
    }, [categoryNames, editData, category]);

    // Handle Escape key
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const setQuickDate = (daysAgo) => {
        const d = new Date();
        d.setDate(d.getDate() - daysAgo);
        setDate(d.toISOString().slice(0, 10));
    };

    const isToday = date === new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date();
    yesterdayDate.setDate(yesterdayDate.getDate() - 1);
    const isYesterday = date === yesterdayDate.toISOString().slice(0, 10);

    const handleSubmit = async (e) => {
        e.preventDefault();
        const parsedAmount = parseFloat(amount);
        if (!amount || isNaN(parsedAmount) || parsedAmount <= 0) {
            toast.error('Please enter a valid expense amount');
            return;
        }
        if (!category) {
            toast.error('Please select a category');
            return;
        }
        if (!date) {
            toast.error('Please select a date');
            return;
        }

        setLoading(true);
        try {
            await onSubmit({
                amount: parsedAmount,
                category,
                date,
                description: description.trim() || null
            });
            toast.success(editData ? 'Expense updated' : 'Expense recorded');
            onClose();
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save expense');
        } finally {
            setLoading(false);
        }
    };

    // Quick select common categories (first 5)
    const quickCategories = categoryNames.slice(0, 5);

    return (
        <div className="modal-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="expense-form-title">
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', height: '100%', maxHeight: '88vh', overflow: 'hidden' }}>
                    {/* Modal Header */}
                    <div className="modal-header">
                        <h2 id="expense-form-title" className="modal-title">
                            {editData ? 'Edit Expense' : 'Add Expense'}
                        </h2>
                        <button 
                            type="button" 
                            className="modal-close-btn" 
                            onClick={onClose} 
                            aria-label="Close form"
                        >
                            <HiOutlineXMark aria-hidden="true" />
                        </button>
                    </div>

                    {/* Scrollable Form Body */}
                    <div className="modal-body" style={{ padding: '1.25rem 1.5rem', overflowY: 'auto', flex: 1 }}>
                        {/* 1. Amount (Prominent numeric input) */}
                        <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                            <label htmlFor="expense-amount" className="form-label" style={{ fontSize: '0.95rem' }}>
                                Amount <span style={{ color: 'var(--color-danger)' }}>*</span>
                            </label>
                            <div className="input-amount-wrapper">
                                <span className="input-currency-prefix" aria-hidden="true">₹</span>
                                <input
                                    id="expense-amount"
                                    type="number"
                                    step="any"
                                    min="0.01"
                                    inputMode="decimal"
                                    value={amount}
                                    onChange={(e) => setAmount(e.target.value)}
                                    className="form-input input-amount-lg num"
                                    placeholder="0"
                                    autoFocus
                                    required
                                    aria-required="true"
                                />
                            </div>
                            <span className="form-hint">Enter the total amount spent</span>
                        </div>

                        {/* 2. Category selection with Quick Pills */}
                        <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                            <label htmlFor="expense-category" className="form-label">
                                Category <span style={{ color: 'var(--color-danger)' }}>*</span>
                            </label>
                            
                            {/* Quick category buttons */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '0.5rem' }}>
                                {quickCategories.map(cat => {
                                    const isSelected = category === cat;
                                    return (
                                        <button
                                            key={cat}
                                            type="button"
                                            onClick={() => setCategory(cat)}
                                            className={`btn btn-sm ${isSelected ? 'btn-primary' : 'btn-outline'}`}
                                            style={{ height: '36px', borderRadius: 'var(--radius-sm)' }}
                                        >
                                            {cat}
                                        </button>
                                    );
                                })}
                            </div>

                            {/* Full category dropdown */}
                            <select
                                id="expense-category"
                                value={category}
                                onChange={(e) => setCategory(e.target.value)}
                                className="form-select"
                                required
                            >
                                {categoryNames.map(c => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>

                        {/* 3. Date with quick Today / Yesterday toggles */}
                        <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                            <label htmlFor="expense-date" className="form-label">
                                Date <span style={{ color: 'var(--color-danger)' }}>*</span>
                            </label>
                            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                                <button
                                    type="button"
                                    onClick={() => setQuickDate(0)}
                                    className={`btn btn-sm ${isToday ? 'btn-secondary' : 'btn-outline'}`}
                                    style={{ flex: 1, height: '36px' }}
                                >
                                    Today
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setQuickDate(1)}
                                    className={`btn btn-sm ${isYesterday ? 'btn-secondary' : 'btn-outline'}`}
                                    style={{ flex: 1, height: '36px' }}
                                >
                                    Yesterday
                                </button>
                            </div>
                            <input
                                id="expense-date"
                                type="date"
                                value={date}
                                onChange={(e) => setDate(e.target.value)}
                                className="form-input"
                                required
                            />
                        </div>

                        {/* 4. Optional Description */}
                        <div className="form-group" style={{ marginBottom: '0.5rem' }}>
                            <label htmlFor="expense-desc" className="form-label">
                                Description <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(Optional)</span>
                            </label>
                            <input
                                id="expense-desc"
                                type="text"
                                maxLength={255}
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                className="form-input"
                                placeholder="e.g. Weekly grocery shopping"
                            />
                        </div>
                    </div>

                    {/* 5. Sticky Action Footer — Always Visible On-Screen */}
                    <div className="modal-footer" style={{ display: 'flex', gap: '0.75rem', flexShrink: 0 }}>
                        <button
                            type="button"
                            className="btn btn-outline"
                            onClick={onClose}
                            style={{ flex: 1 }}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="btn btn-primary btn-lg"
                            disabled={loading}
                            style={{ flex: 2 }}
                        >
                            {loading ? 'Saving...' : (editData ? 'Update Expense' : 'Save Expense')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ExpenseForm;
