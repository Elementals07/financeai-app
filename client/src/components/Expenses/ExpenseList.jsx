import { HiOutlinePencilSquare, HiOutlineTrash, HiOutlineCheck, HiOutlineXMark, HiOutlineTag } from 'react-icons/hi2';
import { useCategories } from '../../hooks/useCategories';

const ExpenseList = ({ expenses = [], onEdit, onDelete, deletingId, onCancelDelete, onStartDelete, loading }) => {
    const { colorMap } = useCategories();

    if (loading) {
        return (
            <div className="card" style={{ padding: '1rem' }}>
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="loading-skeleton" style={{ height: '56px', marginBottom: '0.75rem', borderRadius: 'var(--radius-md)' }} />
                ))}
            </div>
        );
    }

    if (expenses.length === 0) {
        return (
            <div className="card">
                <div className="empty-state">
                    <div className="empty-state-icon">📝</div>
                    <h3>No Expenses Found</h3>
                    <p>There are no recorded expenses matching your current filters. Add a new expense above to get started.</p>
                </div>
            </div>
        );
    }

    const formatDate = (dateStr) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    const formatCurrency = (val) => {
        return '₹' + parseFloat(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    };

    return (
        <div className="table-card">
            {/* Desktop Table View (>= 768px) */}
            <div className="table-responsive desktop-only-table">
                <table className="data-table">
                    <thead>
                        <tr>
                            <th scope="col" style={{ width: '130px' }}>Date</th>
                            <th scope="col" style={{ width: '150px' }}>Category</th>
                            <th scope="col">Description</th>
                            <th scope="col" style={{ textAlign: 'right', width: '140px' }}>Amount</th>
                            <th scope="col" style={{ textAlign: 'right', width: '160px' }}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {expenses.map((exp) => {
                            const isDeleting = deletingId === exp.id;
                            const catColor = colorMap[exp.category] || 'var(--color-primary)';

                            if (isDeleting) {
                                return (
                                    <tr key={exp.id} style={{ backgroundColor: 'var(--color-danger-subtle)' }}>
                                        <td colSpan={3} style={{ color: 'var(--color-danger)', fontWeight: 600, padding: '0.875rem 1rem' }}>
                                            Delete &ldquo;{exp.description || exp.category}&rdquo; for {formatCurrency(exp.amount)}?
                                        </td>
                                        <td colSpan={2} style={{ textAlign: 'right', padding: '0.875rem 1rem' }}>
                                            <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                                                <button
                                                    type="button"
                                                    className="btn btn-danger btn-sm"
                                                    onClick={() => onDelete(exp.id)}
                                                    aria-label="Confirm permanent deletion"
                                                >
                                                    <HiOutlineCheck aria-hidden="true" /> Yes, Delete
                                                </button>
                                                <button
                                                    type="button"
                                                    className="btn btn-outline btn-sm"
                                                    onClick={onCancelDelete}
                                                    aria-label="Cancel deletion"
                                                >
                                                    <HiOutlineXMark aria-hidden="true" /> Cancel
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            }

                            return (
                                <tr key={exp.id}>
                                    <td style={{ color: 'var(--text-secondary)' }}>
                                        {formatDate(exp.date)}
                                    </td>
                                    <td>
                                        <span
                                            className="category-pill"
                                            style={{
                                                borderColor: catColor,
                                                color: catColor,
                                                backgroundColor: `${catColor}12`
                                            }}
                                        >
                                            <span className="category-pill-dot" style={{ backgroundColor: catColor }} />
                                            {exp.category}
                                        </span>
                                    </td>
                                    <td style={{ color: 'var(--text-primary)', fontWeight: 500 }}>
                                        {exp.description || '—'}
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: '#9B1C1C' }} className="num">
                                        -{formatCurrency(exp.amount)}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <div style={{ display: 'inline-flex', gap: '0.375rem', justifyContent: 'flex-end' }}>
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => onEdit(exp)}
                                                aria-label={`Edit ${exp.description || exp.category}`}
                                                style={{ minHeight: '32px', minWidth: '32px', padding: '0 8px' }}
                                            >
                                                <HiOutlinePencilSquare aria-hidden="true" />
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-ghost btn-sm"
                                                onClick={() => onStartDelete(exp.id)}
                                                aria-label={`Delete ${exp.description || exp.category}`}
                                                style={{ minHeight: '32px', minWidth: '32px', padding: '0 8px', color: 'var(--color-danger)' }}
                                            >
                                                <HiOutlineTrash aria-hidden="true" />
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>

            {/* Mobile Touch-Friendly Card List (< 768px) */}
            <div className="mobile-expense-list">
                {expenses.map((exp) => {
                    const isDeleting = deletingId === exp.id;
                    const catColor = colorMap[exp.category] || 'var(--color-primary)';

                    if (isDeleting) {
                        return (
                            <div key={exp.id} className="mobile-expense-item deleting">
                                <div className="mobile-delete-confirm">
                                    <p className="delete-title">Delete {exp.description || exp.category} ({formatCurrency(exp.amount)})?</p>
                                    <div className="delete-actions">
                                        <button 
                                            type="button" 
                                            className="btn btn-danger btn-sm"
                                            onClick={() => onDelete(exp.id)}
                                        >
                                            <HiOutlineCheck aria-hidden="true" /> Yes
                                        </button>
                                        <button 
                                            type="button" 
                                            className="btn btn-outline btn-sm"
                                            onClick={onCancelDelete}
                                        >
                                            <HiOutlineXMark aria-hidden="true" /> Cancel
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    }

                    return (
                        <div key={exp.id} className="mobile-expense-item" onClick={() => onEdit(exp)}>
                            <div 
                                className="mobile-expense-cat-icon"
                                style={{ 
                                    backgroundColor: `${catColor}18`, 
                                    color: catColor 
                                }}
                            >
                                <HiOutlineTag aria-hidden="true" />
                            </div>

                            <div className="mobile-expense-info">
                                <div className="mobile-expense-desc">
                                    {exp.description || exp.category}
                                </div>
                                <div className="mobile-expense-meta">
                                    <span 
                                        className="mobile-cat-badge"
                                        style={{ color: catColor, backgroundColor: `${catColor}14` }}
                                    >
                                        {exp.category}
                                    </span>
                                    <span className="mobile-expense-date">{formatDate(exp.date)}</span>
                                </div>
                            </div>

                            <div className="mobile-expense-amount-col">
                                <div className="mobile-expense-amount num">
                                    -{formatCurrency(exp.amount)}
                                </div>
                                <div className="mobile-item-actions" onClick={(e) => e.stopPropagation()}>
                                    <button
                                        type="button"
                                        className="mobile-action-btn delete"
                                        onClick={() => onStartDelete(exp.id)}
                                        aria-label="Delete expense"
                                    >
                                        <HiOutlineTrash />
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default ExpenseList;
