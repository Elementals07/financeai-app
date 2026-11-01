import { HiOutlinePencilSquare, HiOutlineTrash, HiOutlineCheck, HiOutlineXMark, HiOutlineTag } from 'react-icons/hi2';
import { useCategories } from '../../hooks/useCategories';

const ExpenseList = ({ expenses = [], onEdit, onDelete, deletingId, onCancelDelete, onStartDelete, loading }) => {
    const { colorMap } = useCategories();

    if (loading) {
        return (
            <div className="card" style={{ padding: '1.5rem' }}>
                {[...Array(5)].map((_, i) => (
                    <div key={i} className="loading-skeleton" style={{ height: '48px', marginBottom: '0.75rem', borderRadius: 'var(--radius-sm)' }} />
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
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    };

    const formatCurrency = (val) => {
        return '₹' + parseFloat(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
    };

    return (
        <div className="table-card">
            {/* Desktop Table View */}
            <div className="table-responsive" style={{ display: 'block' }}>
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
                                    <td style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                                        {formatDate(exp.date)}
                                    </td>
                                    <td>
                                        <span className="category-badge">
                                            <span 
                                                className="category-dot" 
                                                style={{ backgroundColor: catColor }} 
                                                aria-hidden="true" 
                                            />
                                            {exp.category}
                                        </span>
                                    </td>
                                    <td>
                                        <span style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                                            {exp.description || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                                        </span>
                                    </td>
                                    <td style={{ textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }} className="num">
                                        {formatCurrency(exp.amount)}
                                    </td>
                                    <td style={{ textAlign: 'right' }}>
                                        <div style={{ display: 'inline-flex', gap: '0.35rem', justifyContent: 'flex-end' }}>
                                            <button
                                                type="button"
                                                className="btn btn-outline btn-sm"
                                                onClick={() => onEdit(exp)}
                                                title="Edit this expense"
                                                aria-label={`Edit expense ${exp.description || exp.category}`}
                                                style={{ minHeight: '36px', padding: '0 8px' }}
                                            >
                                                <HiOutlinePencilSquare aria-hidden="true" />
                                                <span>Edit</span>
                                            </button>
                                            <button
                                                type="button"
                                                className="btn btn-danger-outline btn-sm"
                                                onClick={() => onStartDelete(exp.id)}
                                                title="Delete this expense"
                                                aria-label={`Delete expense ${exp.description || exp.category}`}
                                                style={{ minHeight: '36px', padding: '0 8px' }}
                                            >
                                                <HiOutlineTrash aria-hidden="true" />
                                                <span>Delete</span>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default ExpenseList;
