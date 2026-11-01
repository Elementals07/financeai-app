import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import API from '../api/axios';
import { useAuth } from '../context/AuthContext';
import SummaryCards from '../components/Dashboard/SummaryCards';
import SpendingPieChart from '../components/Dashboard/SpendingPieChart';
import MonthlyTrendChart from '../components/Dashboard/MonthlyTrendChart';
import DailyExpenseChart from '../components/Dashboard/DailyExpenseChart';
import BudgetProgressBar from '../components/Dashboard/BudgetProgressBar';
import ExpenseForm from '../components/Expenses/ExpenseForm';
import { 
    HiOutlinePlus, 
    HiOutlineCalendar, 
    HiOutlineArrowRight,
    HiOutlineSparkles,
    HiOutlineTag
} from 'react-icons/hi2';
import toast from 'react-hot-toast';

const DashboardPage = () => {
    const { user } = useAuth();
    const [summary, setSummary] = useState(null);
    const [budget, setBudget] = useState(null);
    const [recentExpenses, setRecentExpenses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showAddModal, setShowAddModal] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    });

    const fetchDashboardData = useCallback(async () => {
        setLoading(true);
        try {
            const [summaryRes, budgetRes, recentRes] = await Promise.all([
                API.get(`/expenses/summary?month=${currentMonth}`),
                API.get(`/budgets?month=${currentMonth}`),
                API.get(`/expenses?limit=5`)
            ]);
            setSummary({
                ...summaryRes.data.data,
                monthlyIncome: user?.monthly_income || 0
            });
            setBudget(budgetRes.data.data);
            setRecentExpenses(recentRes.data.data || []);
        } catch (err) {
            toast.error('Failed to load dashboard data');
        } finally {
            setLoading(false);
        }
    }, [currentMonth, user?.monthly_income]);

    useEffect(() => {
        fetchDashboardData();
    }, [fetchDashboardData]);

    const handleMonthChange = (e) => {
        setCurrentMonth(e.target.value);
    };

    const handleCreateExpense = async (expenseData) => {
        await API.post('/expenses', expenseData);
        fetchDashboardData();
    };

    // Generate month options
    const generateMonthOptions = () => {
        const options = [];
        const now = new Date();
        for (let i = -24; i <= 3; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
            const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            const label = d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
            options.push({ val, label });
        }
        return options;
    };

    const getGreeting = () => {
        const hour = new Date().getHours();
        if (hour < 12) return 'Good morning';
        if (hour < 17) return 'Good afternoon';
        return 'Good evening';
    };

    const firstName = user?.name?.split(' ')[0] || 'Friend';

    const formatCurrency = (val) => '₹' + Math.abs(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
    const formatDate = (dateStr) => {
        const d = new Date(dateStr);
        return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    };

    // Identify largest category
    const categoryBreakdown = summary?.categoryBreakdown || [];
    const largestCategory = categoryBreakdown.length > 0 
        ? [...categoryBreakdown].sort((a, b) => b.total - a.total)[0]
        : null;

    if (loading) {
        return (
            <div>
                <div className="page-header">
                    <div className="loading-skeleton" style={{ width: '120px', height: '22px', borderRadius: '12px', marginBottom: '0.5rem' }} />
                    <div className="loading-skeleton" style={{ width: '280px', height: '36px', borderRadius: '8px' }} />
                </div>
                <div className="summary-cards">
                    {[...Array(4)].map((_, i) => (
                        <div key={i} className="card" style={{ height: '140px' }}>
                            <div className="loading-skeleton" style={{ width: '40px', height: '40px', borderRadius: '8px', marginBottom: '1rem' }} />
                            <div className="loading-skeleton" style={{ width: '60%', height: '14px', marginBottom: '0.5rem' }} />
                            <div className="loading-skeleton" style={{ width: '40%', height: '26px' }} />
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div>
            {/* Header: Greeting, Month Selector & Fast Add Expense Action */}
            <div className="page-header">
                <div className="page-header-row">
                    <div>
                        <div className="page-tag">
                            <span style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--color-primary)' }} />
                            Everyday Ledger Overview
                        </div>
                        <h1 className="page-title">
                            {getGreeting()}, {firstName}
                        </h1>
                        <p className="page-subtitle">
                            Here is where your money stands for {new Date(currentMonth + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}.
                        </p>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                        {/* Month Selector */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: 'var(--bg-surface)', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', padding: '0.25rem 0.5rem' }}>
                            <HiOutlineCalendar aria-hidden="true" style={{ color: 'var(--text-secondary)', fontSize: '1.1rem' }} />
                            <label htmlFor="period-select" className="sr-only">Select Period</label>
                            <select 
                                id="period-select"
                                value={currentMonth} 
                                onChange={handleMonthChange}
                                className="form-select"
                                style={{ 
                                    padding: '0.35rem 0.75rem', 
                                    border: 'none', 
                                    background: 'transparent',
                                    fontSize: '0.875rem',
                                    fontWeight: 600,
                                    color: 'var(--text-primary)',
                                    minHeight: '36px'
                                }}
                            >
                                {generateMonthOptions().map(opt => (
                                    <option key={opt.val} value={opt.val}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        {/* Fast Add Expense Action Button */}
                        <button 
                            type="button"
                            className="btn btn-primary"
                            onClick={() => setShowAddModal(true)}
                            aria-label="Add a new expense"
                        >
                            <HiOutlinePlus aria-hidden="true" />
                            Add Expense
                        </button>
                    </div>
                </div>
            </div>

            {/* A. Primary Financial Summary Cards */}
            <SummaryCards 
                summary={summary} 
                budget={budget} 
                onIncomeUpdate={fetchDashboardData} 
            />

            {/* B. Core Operational Grid: Budget Progress & Largest Category Insight */}
            <div className="charts-grid" style={{ marginBottom: '1.5rem' }}>
                {/* Budget Progress & Status */}
                <BudgetProgressBar 
                    budget={budget} 
                    currentMonth={currentMonth} 
                />

                {/* Largest Spending Callout & Category Distribution */}
                <div className="card">
                    <div className="card-header">
                        <div>
                            <h2 className="card-title">Top Spending Category</h2>
                            <p className="card-subtitle">Where the largest portion went this month</p>
                        </div>
                    </div>

                    {largestCategory ? (
                        <div>
                            <div style={{ 
                                padding: '1rem', 
                                backgroundColor: 'var(--bg-surface-subtle)', 
                                border: '1px solid var(--border-color)', 
                                borderRadius: 'var(--radius-md)',
                                marginBottom: '1.25rem',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between'
                            }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', fontWeight: 700 }}>
                                        Highest Outflow
                                    </div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--text-primary)', marginTop: '0.2rem' }}>
                                        {largestCategory.category}
                                    </div>
                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                                        {summary?.totalSpending > 0 ? `${Math.round((largestCategory.total / summary.totalSpending) * 100)}% of your total spending` : ''}
                                    </div>
                                </div>
                                <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--color-accent)' }} className="num">
                                    {formatCurrency(largestCategory.total)}
                                </div>
                            </div>

                            <div style={{ fontSize: '0.8125rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
                                Other Recorded Categories
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
                                {categoryBreakdown.slice(1, 5).map(cat => (
                                    <div key={cat.category} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.875rem' }}>
                                        <span style={{ color: 'var(--text-secondary)' }}>{cat.category}</span>
                                        <span className="num" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                            {formatCurrency(cat.total)}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ) : (
                        <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                            <div className="empty-state-icon">🏷️</div>
                            <h3>No Category Data</h3>
                            <p>Recorded expenses will automatically be categorized and summarized here.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* C. Recent Expenses Preview with 'See All' Action */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
                <div className="card-header">
                    <div>
                        <h2 className="card-title">Recent Expenses</h2>
                        <p className="card-subtitle">Latest recorded transactions</p>
                    </div>
                    <Link to="/expenses" className="btn btn-outline btn-sm">
                        See All Expenses <HiOutlineArrowRight aria-hidden="true" />
                    </Link>
                </div>

                {recentExpenses.length > 0 ? (
                    <div className="transaction-list">
                        {recentExpenses.map(exp => (
                            <div key={exp.id} className="transaction-card">
                                <div className="transaction-main">
                                    <div className="category-badge">
                                        <HiOutlineTag aria-hidden="true" />
                                        {exp.category}
                                    </div>
                                    <div className="transaction-details">
                                        <span className="transaction-title">
                                            {exp.description || `${exp.category} expense`}
                                        </span>
                                        <span className="transaction-meta">
                                            {formatDate(exp.date)}
                                        </span>
                                    </div>
                                </div>
                                <div className="transaction-amount num">
                                    -{formatCurrency(exp.amount)}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                        <div className="empty-state-icon">📝</div>
                        <h3>No Expenses Recorded</h3>
                        <p>Track your first expense in seconds.</p>
                        <button 
                            type="button" 
                            className="btn btn-primary btn-sm"
                            onClick={() => setShowAddModal(true)}
                        >
                            <HiOutlinePlus aria-hidden="true" /> Add Expense
                        </button>
                    </div>
                )}
            </div>

            {/* D. Analytical Charts (Lower on the page) */}
            <div className="charts-grid">
                <SpendingPieChart categoryBreakdown={summary?.categoryBreakdown || []} />
                <DailyExpenseChart dailySpending={summary?.dailySpending || []} currentMonth={currentMonth} />
            </div>

            <div style={{ marginTop: '1.5rem' }}>
                <MonthlyTrendChart trends={summary?.trends || []} />
            </div>

            {/* Quick Add Expense Modal */}
            {showAddModal && (
                <ExpenseForm 
                    onSubmit={handleCreateExpense}
                    onClose={() => setShowAddModal(false)}
                />
            )}
        </div>
    );
};

export default DashboardPage;
