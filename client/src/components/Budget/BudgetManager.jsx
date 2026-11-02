import { useState, useEffect, useCallback } from 'react';
import API from '../../api/axios';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { useCategories } from '../../hooks/useCategories';
import { 
    HiOutlineBanknotes, 
    HiOutlineCheck, 
    HiOutlineExclamationTriangle,
    HiOutlineInformationCircle,
    HiOutlineCalendar
} from 'react-icons/hi2';

const BudgetManager = () => {
    const { categoryNames, colorMap } = useCategories();
    const { user, updateUser } = useAuth();
    const [budget, setBudget] = useState(null);
    const [allocationsInput, setAllocationsInput] = useState({});
    const [incomeInput, setIncomeInput] = useState('');
    const [monthInput, setMonthInput] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });
    const [saving, setSaving] = useState(false);
    const [validationError, setValidationError] = useState('');

    const fetchBudget = useCallback(async (month) => {
        setValidationError('');
        try {
            const res = await API.get(`/budgets?month=${month}`);
            setBudget(res.data.data);
            const currentIncome = res.data.data.budgetAmount || user?.monthly_income || 0;
            setIncomeInput(currentIncome > 0 ? String(currentIncome) : '');
            
            // Populate allocations input
            const allocs = res.data.data.allocations || {};
            const initialInputs = {};
            categoryNames.forEach(c => {
                initialInputs[c] = allocs[c] !== undefined && allocs[c] !== null ? String(allocs[c]) : '';
            });
            setAllocationsInput(initialInputs);
        } catch (err) {
            console.error('Failed to fetch budget:', err);
            toast.error('Failed to load budget data');
        }
    }, [categoryNames, user?.monthly_income]);

    useEffect(() => {
        fetchBudget(monthInput);
    }, [fetchBudget, monthInput]);

    const handleInputChange = (category, value) => {
        setAllocationsInput(prev => ({
            ...prev,
            [category]: value
        }));
    };

    // Calculate total planned spending from user inputs
    const totalAllocated = Object.values(allocationsInput).reduce((sum, val) => {
        const num = parseFloat(val);
        return sum + (!isNaN(num) && num > 0 ? num : 0);
    }, 0);

    const parsedIncome = parseFloat(incomeInput) || 0;
    const unallocatedAmount = parsedIncome - totalAllocated;
    const isOverAllocated = parsedIncome > 0 && totalAllocated > parsedIncome;

    const handleSave = async (e) => {
        e.preventDefault();
        setValidationError('');

        // 1. Validate income
        if (incomeInput && (isNaN(parsedIncome) || parsedIncome < 0)) {
            setValidationError('Please enter a valid positive number for monthly income');
            toast.error('Invalid income amount');
            return;
        }

        // 2. Validate category allocations
        const payload = [];
        for (const [cat, val] of Object.entries(allocationsInput)) {
            if (val !== '' && val !== null && val !== undefined) {
                const amt = parseFloat(val);
                if (isNaN(amt) || amt < 0) {
                    setValidationError(`Invalid amount for ${cat}. Values cannot be negative.`);
                    toast.error(`Please correct the amount for ${cat}`);
                    return;
                }
                if (amt > 0) {
                    payload.push({ category: cat, amount: amt });
                }
            }
        }

        setSaving(true);
        try {
            // Update user profile income if changed
            if (parsedIncome > 0) {
                await API.put('/auth/profile', {
                    name: user?.name,
                    monthly_income: parsedIncome
                });
                updateUser({ monthly_income: parsedIncome });
            }

            // Save budget allocations if any are specified
            if (payload.length > 0) {
                await API.post('/budgets', {
                    allocations: payload,
                    month: monthInput
                });
            }

            toast.success('Budget plan saved successfully!');
            fetchBudget(monthInput);
        } catch (err) {
            toast.error(err.response?.data?.message || 'Failed to save budget');
        } finally {
            setSaving(false);
        }
    };

    const formatCurrency = (val) => '₹' + Math.abs(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

    const totalSpent = budget?.totalSpent || 0;
    const budgetAmount = budget?.budgetAmount || parsedIncome;
    const remaining = budgetAmount > 0 ? budgetAmount - totalSpent : 0;
    const percentUsed = budget?.percentUsed || 0;
    const clampedPercent = Math.min(percentUsed, 100);

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {/* Plain Language Explainer Guide */}
            <div className="card" style={{ marginBottom: '1.5rem', backgroundColor: 'var(--bg-surface-subtle)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                    <HiOutlineInformationCircle style={{ color: 'var(--color-primary)', fontSize: '1.25rem' }} />
                    <h2 style={{ fontSize: '1rem', fontWeight: 700, margin: 0 }}>
                        How Monthly Budgeting Works
                    </h2>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '0.75rem', fontSize: '0.875rem' }}>
                    <div>
                        <strong>Monthly Income:</strong> Money received in the month.
                    </div>
                    <div>
                        <strong>Category Limit:</strong> The maximum you plan to spend.
                    </div>
                    <div>
                        <strong>Money Spent:</strong> What you have already paid.
                    </div>
                    <div>
                        <strong>Remaining:</strong> Money still available within your plan.
                    </div>
                </div>
            </div>

            {/* Month Selection Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', padding: '0.4rem 0.8rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)' }}>
                    <HiOutlineCalendar style={{ color: 'var(--text-secondary)' }} />
                    <label htmlFor="budget-month" style={{ fontSize: '0.875rem', fontWeight: 600 }}>Plan for:</label>
                    <input
                        id="budget-month"
                        type="month"
                        value={monthInput}
                        onChange={(e) => setMonthInput(e.target.value)}
                        className="form-input"
                        style={{ minHeight: '34px', padding: '0.2rem 0.5rem', fontSize: '0.875rem', width: 'auto', border: 'none', background: 'transparent' }}
                    />
                </div>
            </div>

            {/* Current Month Spending Progress */}
            {budget?.hasBudget && (
                <div className="card" style={{ marginBottom: '1.5rem' }}>
                    <div className="card-header">
                        <div>
                            <h2 className="card-title">Spending Status for This Month</h2>
                            <p className="card-subtitle">Actual expenses tracked against your target plan</p>
                        </div>
                        <span className={`summary-card-tag ${percentUsed >= 100 ? 'danger' : (percentUsed >= 80 ? 'warning' : 'positive')}`}>
                            {percentUsed >= 100 ? 'Limit Exceeded' : (percentUsed >= 80 ? 'Close to Limit' : 'Within Plan')}
                        </span>
                    </div>

                    <div style={{ marginBottom: '0.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.875rem', marginBottom: '0.35rem' }}>
                            <span><strong>{percentUsed}%</strong> of budget used</span>
                            <span style={{ fontWeight: 600, color: remaining < 0 ? 'var(--color-danger)' : 'var(--color-primary)' }}>
                                {remaining < 0 ? `Over by ${formatCurrency(Math.abs(remaining))}` : `${formatCurrency(remaining)} remaining`}
                            </span>
                        </div>
                        <div className="progress-bar-container" style={{ height: '14px' }}>
                            <div
                                className={`progress-bar ${percentUsed >= 100 ? 'danger' : (percentUsed >= 80 ? 'warning' : '')}`}
                                style={{ width: `${clampedPercent}%` }}
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                        <span>Total Spent: <strong className="num">{formatCurrency(totalSpent)}</strong></span>
                        <span>Monthly Plan: <strong className="num">{formatCurrency(budgetAmount)}</strong></span>
                    </div>
                </div>
            )}

            {/* Budget Configuration Form */}
            <form onSubmit={handleSave} className="card">
                <div className="card-header">
                    <div>
                        <h2 className="card-title">Set Monthly Income & Category Limits</h2>
                        <p className="card-subtitle">Decide how much you plan to spend across categories</p>
                    </div>
                </div>

                {/* Over-allocation warning banner */}
                {isOverAllocated && (
                    <div className="status-banner warning" style={{ marginBottom: '1.25rem' }}>
                        <HiOutlineExclamationTriangle className="status-banner-icon" aria-hidden="true" />
                        <div className="status-banner-text">
                            <strong>Note on Planned Allocations:</strong> Your total category limits ({formatCurrency(totalAllocated)}) exceed your monthly income ({formatCurrency(parsedIncome)}) by {formatCurrency(totalAllocated - parsedIncome)}. You can still save this plan if you intend to draw from existing savings.
                        </div>
                    </div>
                )}

                {validationError && (
                    <div className="status-banner danger" style={{ marginBottom: '1.25rem' }}>
                        <HiOutlineExclamationTriangle className="status-banner-icon" aria-hidden="true" />
                        <div className="status-banner-text">{validationError}</div>
                    </div>
                )}

                {/* 1. Monthly Income Input */}
                <div className="form-group" style={{ marginBottom: '1.5rem', paddingBottom: '1.25rem', borderBottom: '1px solid var(--border-color)' }}>
                    <label htmlFor="budget-income" className="form-label">
                        Monthly Income (₹) <span style={{ color: 'var(--color-danger)' }}>*</span>
                    </label>
                    <div className="input-amount-wrapper">
                        <span className="input-currency-prefix" aria-hidden="true">₹</span>
                        <input
                            id="budget-income"
                            type="number"
                            min="0"
                            step="any"
                            value={incomeInput}
                            onChange={(e) => setIncomeInput(e.target.value)}
                            className="form-input input-amount-lg num"
                            placeholder="e.g. 50000"
                            required
                        />
                    </div>
                    <span className="form-hint">Your expected monthly take-home income</span>
                </div>

                {/* Allocation Summary Bar */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface-subtle)', padding: '0.75rem 1rem', borderRadius: 'var(--radius-sm)', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                    <div>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Total Category Limits: </span>
                        <strong className="num" style={{ fontSize: '1rem', color: 'var(--text-primary)' }}>{formatCurrency(totalAllocated)}</strong>
                    </div>
                    <div>
                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Unallocated Income: </span>
                        <strong className="num" style={{ fontSize: '1rem', color: unallocatedAmount < 0 ? 'var(--color-danger)' : 'var(--color-primary)' }}>
                            {unallocatedAmount < 0 ? '-' : ''}{formatCurrency(unallocatedAmount)}
                        </strong>
                    </div>
                </div>

                {/* 2. Category Allocations Inputs */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginBottom: '1.5rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Category Spending Limits
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '1rem' }}>
                        {categoryNames.map(cat => {
                            const val = allocationsInput[cat] || '';
                            const spent = budget?.allocations?.[cat] ? (budget?.categoryBreakdown?.find(c => c.category === cat)?.total || 0) : 0;
                            const catColor = colorMap[cat] || 'var(--color-primary)';

                            return (
                                <div key={cat} style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.75rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                            <span className="category-dot" style={{ backgroundColor: catColor }} />
                                            <label htmlFor={`cat-limit-${cat}`} style={{ fontWeight: 600, fontSize: '0.875rem' }}>
                                                {cat}
                                            </label>
                                        </div>
                                        {spent > 0 && (
                                            <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                Spent: {formatCurrency(spent)}
                                            </span>
                                        )}
                                    </div>

                                    <div className="input-amount-wrapper">
                                        <span style={{ position: 'absolute', left: '10px', color: 'var(--text-secondary)', fontWeight: 600 }}>₹</span>
                                        <input
                                            id={`cat-limit-${cat}`}
                                            type="number"
                                            min="0"
                                            step="any"
                                            value={val}
                                            onChange={(e) => handleInputChange(cat, e.target.value)}
                                            placeholder="No limit"
                                            className="form-input num"
                                            style={{ paddingLeft: '1.75rem', minHeight: '38px', fontSize: '0.9rem' }}
                                        />
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Save Button */}
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                    <button
                        type="submit"
                        className="btn btn-primary btn-lg"
                        disabled={saving}
                    >
                        <HiOutlineCheck aria-hidden="true" />
                        {saving ? 'Saving Plan...' : 'Save Spending Plan'}
                    </button>
                </div>
            </form>
        </div>
    );
};

export default BudgetManager;
