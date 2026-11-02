import { Link } from 'react-router-dom';
import { HiOutlineCheckCircle, HiOutlineExclamationTriangle, HiOutlineXCircle, HiOutlineArrowRight } from 'react-icons/hi2';

const BudgetProgressBar = ({ budget, currentMonth }) => {
    const formatCurrency = (val) => '₹' + Math.abs(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

    if (!budget || !budget.hasBudget) {
        return (
            <div className="card">
                <div className="card-header">
                    <div>
                        <h2 className="card-title">Budget Status</h2>
                        <p className="card-subtitle">Spending against planned monthly limits</p>
                    </div>
                </div>
                <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                    <div className="empty-state-icon">🎯</div>
                    <h3>No Spending Plan Set</h3>
                    <p>Set a monthly budget to track category limits and prevent overspending.</p>
                    <Link to="/budget" className="btn btn-primary btn-sm">
                        Create Spending Plan <HiOutlineArrowRight aria-hidden="true" />
                    </Link>
                </div>
            </div>
        );
    }

    const { budgetAmount, totalSpent, remaining, percentUsed } = budget;
    const clampedPercent = Math.min(percentUsed, 100);

    // Check individual category limits
    const categoryBreakdown = budget.categoryBreakdown || [];
    const overspentCategories = categoryBreakdown.filter(c => (c.allocated || 0) > 0 && c.spent > c.allocated);

    let statusType = 'good';
    let statusText = 'Good: You are within your spending plan';
    let StatusIcon = HiOutlineCheckCircle;

    if (percentUsed >= 100) {
        statusType = 'danger';
        statusText = 'Exceeded: You have spent more than your planned monthly budget';
        StatusIcon = HiOutlineXCircle;
    } else if (overspentCategories.length > 0) {
        statusType = 'warning';
        const catNames = overspentCategories.map(c => c.category).join(', ');
        statusText = `Caution: Overall budget is under limit, but ${overspentCategories.length} ${overspentCategories.length === 1 ? 'category' : 'categories'} (${catNames}) exceeded planned limits`;
        StatusIcon = HiOutlineExclamationTriangle;
    } else if (percentUsed >= 80) {
        statusType = 'warning';
        statusText = 'Warning: Your spending is approaching the limit';
        StatusIcon = HiOutlineExclamationTriangle;
    }

    return (
        <div className="card">
            <div className="card-header">
                <div>
                    <h2 className="card-title">Budget Status</h2>
                    <p className="card-subtitle">Spending against planned monthly limits</p>
                </div>
                <Link to="/budget" className="btn btn-outline btn-sm">
                    Adjust Limits
                </Link>
            </div>

            {/* Status Banner */}
            <div className={`status-banner ${statusType}`} style={{ marginBottom: '1.25rem' }}>
                <StatusIcon className="status-banner-icon" aria-hidden="true" />
                <div className="status-banner-text">
                    <strong>{statusText}</strong>
                </div>
            </div>

            {/* Overall Progress Bar */}
            <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                        <strong>{percentUsed}%</strong> of spending plan used
                    </span>
                    <span style={{ fontWeight: 600, color: percentUsed >= 100 ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                        {percentUsed >= 100 ? `Exceeded by ${formatCurrency(totalSpent - budgetAmount)}` : `${formatCurrency(remaining)} remaining`}
                    </span>
                </div>

                <div className="progress-bar-container" style={{ height: '12px' }}>
                    <div
                        className={`progress-bar ${statusType}`}
                        style={{ width: `${clampedPercent}%` }}
                        role="progressbar"
                        aria-valuenow={clampedPercent}
                        aria-valuemin="0"
                        aria-valuemax="100"
                        aria-label="Overall budget usage"
                    />
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.5rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    <span>Spent: <strong className="num">{formatCurrency(totalSpent)}</strong></span>
                    <span>Plan: <strong className="num">{formatCurrency(budgetAmount)}</strong></span>
                </div>
            </div>

            {/* Category Allocations with horizontal bars */}
            {budget.categoryBreakdown && budget.categoryBreakdown.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
                        Category Breakdown
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {budget.categoryBreakdown.slice(0, 6).map((cat) => {
                            const catBudget = budget.allocations ? (budget.allocations[cat.category] || 0) : 0;
                            const catPercent = catBudget > 0 ? Math.round((cat.total / catBudget) * 100) : null;
                            const clampedCat = catPercent !== null ? Math.min(catPercent, 100) : 0;
                            const isOver = catBudget > 0 && cat.total > catBudget;

                            return (
                                <div key={cat.category} style={{ fontSize: '0.875rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {cat.category}
                                        </span>
                                        <span style={{ color: isOver ? 'var(--color-danger)' : 'var(--text-secondary)', fontWeight: isOver ? 700 : 500 }}>
                                            <span className="num">{formatCurrency(cat.total)}</span>
                                            {catBudget > 0 && (
                                                <span style={{ color: 'var(--text-muted)' }}> / {formatCurrency(catBudget)} ({catPercent}%)</span>
                                            )}
                                        </span>
                                    </div>
                                    {catBudget > 0 && (
                                        <div className="progress-bar-container" style={{ height: '6px' }}>
                                            <div
                                                className={`progress-bar ${isOver ? 'danger' : (catPercent >= 80 ? 'warning' : '')}`}
                                                style={{ width: `${clampedCat}%` }}
                                            />
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

export default BudgetProgressBar;
