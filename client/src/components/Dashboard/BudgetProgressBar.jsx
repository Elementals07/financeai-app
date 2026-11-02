import { Link } from 'react-router-dom';
import { HiOutlineCheckCircle, HiOutlineExclamationTriangle, HiOutlineXCircle, HiOutlineArrowRight } from 'react-icons/hi2';
import { computeBudgetStatus } from '../../services/financeParsers';

const BudgetProgressBar = ({ budget }) => {
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
    const clampedPercent = Math.min(Math.max(percentUsed || 0, 0), 100);

    const categoryBreakdown = Array.isArray(budget.categoryBreakdown) ? budget.categoryBreakdown : [];
    const overspentCategories = categoryBreakdown.filter(
        row => Number(row.allocation) > 0 && Number(row.spent) > Number(row.allocation)
    );

    const status = budget.status || computeBudgetStatus({
        budgetAmount,
        totalSpent,
        categoryBreakdown
    });

    const statusType = status.level === 'danger'
        ? 'danger'
        : status.level === 'warning'
            ? 'warning'
            : 'good';

    const StatusIcon = statusType === 'danger'
        ? HiOutlineXCircle
        : statusType === 'warning'
            ? HiOutlineExclamationTriangle
            : HiOutlineCheckCircle;

    // Keep overspent categories visible at the top of the compact list.
    const displayCategories = [...categoryBreakdown]
        .sort((a, b) => {
            if (a.isOverBudget !== b.isOverBudget) return a.isOverBudget ? -1 : 1;
            return b.spent - a.spent;
        })
        .slice(0, 6);

    const isOver = Boolean(budget.isOverBudget) || (budgetAmount > 0 && totalSpent > budgetAmount);

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
                    <strong>{status.message}</strong>
                </div>
            </div>

            {/* Overall Progress Bar */}
            <div style={{ marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem', fontSize: '0.875rem', gap: '0.75rem', flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                        <strong>{percentUsed || 0}%</strong> of spending plan used
                    </span>
                    <span style={{ fontWeight: 600, color: isOver ? 'var(--color-danger)' : 'var(--text-primary)' }}>
                        {isOver
                            ? `Exceeded by ${formatCurrency(totalSpent - budgetAmount)}`
                            : `${formatCurrency(remaining)} remaining`}
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

            {/* Category-specific utilisation */}
            {displayCategories.length > 0 && (
                <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem', gap: '0.5rem' }}>
                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            Category Breakdown
                        </div>
                        {overspentCategories.length > 0 && (
                            <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-danger)' }}>
                                {overspentCategories.length} over limit
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                        {displayCategories.map((cat) => {
                            const allocation = Number(cat.allocation) || 0;
                            const spent = Number(cat.spent ?? cat.total) || 0;
                            const catPercent = allocation > 0
                                ? Math.round((spent / allocation) * 100)
                                : null;
                            const clampedCat = catPercent !== null ? Math.min(Math.max(catPercent, 0), 100) : 0;
                            const categoryIsOver = allocation > 0 && spent > allocation;

                            return (
                                <div key={cat.category} style={{ fontSize: '0.875rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem', gap: '0.5rem' }}>
                                        <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {cat.category}
                                        </span>
                                        <span style={{ color: categoryIsOver ? 'var(--color-danger)' : 'var(--text-secondary)', fontWeight: categoryIsOver ? 700 : 500, textAlign: 'right' }}>
                                            <span className="num">{formatCurrency(spent)}</span>
                                            {allocation > 0 ? (
                                                <span style={{ color: categoryIsOver ? 'var(--color-danger)' : 'var(--text-muted)' }}>
                                                    {' / '}{formatCurrency(allocation)} ({catPercent}%)
                                                </span>
                                            ) : (
                                                <span style={{ color: 'var(--text-muted)' }}> (no limit)</span>
                                            )}
                                        </span>
                                    </div>
                                    {allocation > 0 ? (
                                        <div className="progress-bar-container" style={{ height: '6px' }}>
                                            <div
                                                className={`progress-bar ${categoryIsOver ? 'danger' : (catPercent >= 80 ? 'warning' : '')}`}
                                                style={{ width: `${clampedCat}%` }}
                                            />
                                        </div>
                                    ) : (
                                        <div className="progress-bar-container" style={{ height: '6px', opacity: 0.35 }}>
                                            <div className="progress-bar" style={{ width: '4%' }} />
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
