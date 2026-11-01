import { useState, useEffect, useRef } from 'react';
import API from '../api/axios';
import { Bar } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
} from 'chart.js';
import { 
    HiOutlineBanknotes, 
    HiOutlineArrowTrendingUp, 
    HiOutlineSparkles,
    HiOutlineInformationCircle
} from 'react-icons/hi2';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend
);

const SavingsPage = () => {
    const [history, setHistory] = useState([]);
    const [loading, setLoading] = useState(true);
    const scrollRef = useRef(null);

    useEffect(() => {
        const fetchSavings = async () => {
            try {
                const res = await API.get('/expenses/savings');
                setHistory(res.data.data || []);
            } catch (err) {
                console.error('Failed to fetch savings history', err);
            } finally {
                setLoading(false);
            }
        };
        fetchSavings();
    }, []);

    // Scroll to the latest month when loaded
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [history]);

    const formatCurrency = (val) => '₹' + Math.abs(val || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    let lastYear = null;

    const reversedHistory = [...history].reverse();
    const labels = reversedHistory.map(h => {
        const [y, m] = h.month.split('-');
        const monthName = monthNames[parseInt(m, 10) - 1];
        if (y !== lastYear) {
            lastYear = y;
            return `${monthName} ${y}`;
        }
        return monthName;
    });

    const chartData = {
        labels,
        datasets: [
            {
                label: 'Monthly Income',
                data: reversedHistory.map(h => h.income),
                backgroundColor: '#2D3FBF',
                borderColor: '#2D3FBF',
                borderWidth: 1,
                borderRadius: 4
            },
            {
                label: 'Money Spent',
                data: reversedHistory.map(h => h.spent),
                backgroundColor: '#9B1C1C',
                borderColor: '#9B1C1C',
                borderWidth: 1,
                borderRadius: 4
            }
        ]
    };

    const chartOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                position: 'top',
                labels: {
                    color: '#252D29',
                    font: { family: '"DM Sans", sans-serif', size: 13, weight: '600' },
                    usePointStyle: true,
                    padding: 16
                }
            },
            tooltip: {
                backgroundColor: '#252D29',
                titleColor: '#FFFFFF',
                bodyColor: '#D6DDFA',
                borderColor: '#2D3FBF',
                borderWidth: 1,
                cornerRadius: 6,
                padding: 10,
                titleFont: { family: '"DM Sans", sans-serif', weight: '600' },
                bodyFont: { family: '"DM Sans", sans-serif' },
                callbacks: {
                    label: (ctx) => ` ${ctx.dataset.label}: ₹${ctx.parsed.y.toLocaleString('en-IN')}`
                }
            }
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: {
                    color: '#69736C',
                    font: { family: '"DM Sans", sans-serif', size: 12 }
                }
            },
            y: {
                grid: { color: '#E2DFD6' },
                ticks: {
                    color: '#69736C',
                    font: { family: '"DM Sans", sans-serif', size: 12 },
                    callback: (v) => '₹' + (v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)
                }
            }
        }
    };

    const totalSavings = history.reduce((sum, h) => sum + h.savings, 0);
    const avgSavings = history.length > 0 ? Math.round(totalSavings / history.length) : 0;
    const bestMonth = history.length > 0 
        ? history.reduce((max, h) => h.savings > max.savings ? h : max, history[0])
        : null;

    const minWidth = Math.max(280, reversedHistory.length * 60);

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
            {/* Page Header */}
            <div className="page-header">
                <div className="page-tag">
                    Savings Trajectory
                </div>
                <h1 className="page-title">My Savings</h1>
                <p className="page-subtitle">
                    Track the difference between your monthly income and recorded spending over time.
                </p>
            </div>

            {/* Scope Clarification Notice */}
            <div className="status-banner info" style={{ marginBottom: '1.5rem' }}>
                <HiOutlineInformationCircle className="status-banner-icon" aria-hidden="true" />
                <div className="status-banner-text">
                    <strong>Note:</strong> Savings values are calculated as your recorded monthly income minus recorded expenses. They reflect tracked monthly surplus, not bank account balances or external investments.
                </div>
            </div>

            {/* Top 3 KPI Cards */}
            <div className="summary-cards" style={{ marginBottom: '1.5rem' }}>
                {/* 1. Total Savings */}
                <div className="summary-card">
                    <div className="summary-card-header">
                        <div className="summary-card-icon" style={{ backgroundColor: totalSavings >= 0 ? 'var(--color-primary-subtle)' : 'var(--color-danger-subtle)', color: totalSavings >= 0 ? 'var(--color-primary)' : 'var(--color-danger)' }}>
                            <HiOutlineBanknotes aria-hidden="true" />
                        </div>
                        <span className={`summary-card-tag ${totalSavings >= 0 ? 'positive' : 'danger'}`}>
                            {totalSavings >= 0 ? 'Surplus' : 'Deficit'}
                        </span>
                    </div>
                    <div className="summary-card-label">Total Savings</div>
                    <div className="summary-card-value financial-figure" style={{ color: totalSavings >= 0 ? 'var(--color-primary)' : 'var(--color-danger)' }}>
                        {totalSavings < 0 ? '-' : '+'}{formatCurrency(totalSavings)}
                    </div>
                    <div className="summary-card-helper">
                        Across {history.length} recorded {history.length === 1 ? 'month' : 'months'}
                    </div>
                </div>

                {/* 2. Average Monthly Savings */}
                <div className="summary-card">
                    <div className="summary-card-header">
                        <div className="summary-card-icon" style={{ backgroundColor: avgSavings >= 0 ? 'var(--color-secondary)' : 'var(--color-danger-subtle)', color: avgSavings >= 0 ? 'var(--color-primary)' : 'var(--color-danger)' }}>
                            <HiOutlineArrowTrendingUp aria-hidden="true" />
                        </div>
                    </div>
                    <div className="summary-card-label">Average Monthly Savings</div>
                    <div className="summary-card-value financial-figure" style={{ color: avgSavings >= 0 ? 'var(--color-primary)' : 'var(--color-danger)' }}>
                        {avgSavings < 0 ? '-' : '+'}{formatCurrency(avgSavings)}
                    </div>
                    <div className="summary-card-helper">
                        Average difference per tracked month
                    </div>
                </div>

                {/* 3. Best Savings Month */}
                <div className="summary-card">
                    <div className="summary-card-header">
                        <div className="summary-card-icon" style={{ backgroundColor: 'var(--color-accent-subtle)', color: 'var(--color-accent)' }}>
                            <HiOutlineSparkles aria-hidden="true" />
                        </div>
                        {bestMonth && (
                            <span className="summary-card-tag positive">
                                {bestMonth.month}
                            </span>
                        )}
                    </div>
                    <div className="summary-card-label">Best Savings Month</div>
                    <div className="summary-card-value financial-figure" style={{ color: 'var(--color-accent)' }}>
                        {bestMonth ? `+${formatCurrency(bestMonth.savings)}` : '—'}
                    </div>
                    <div className="summary-card-helper">
                        {bestMonth ? `Highest savings in ${bestMonth.month}` : 'No history yet'}
                    </div>
                </div>
            </div>

            {/* Income vs Spending Comparison Chart */}
            <div className="card" style={{ marginBottom: '1.5rem' }}>
                <div className="card-header">
                    <div>
                        <h2 className="card-title">Income and Spending Comparison</h2>
                        <p className="card-subtitle">Comparing money in vs money out month-by-month</p>
                    </div>
                </div>

                {loading ? (
                    <div className="loading-skeleton" style={{ height: '300px', borderRadius: 'var(--radius-sm)' }} />
                ) : history.length === 0 ? (
                    <div className="empty-state" style={{ padding: '3rem 1rem' }}>
                        <div className="empty-state-icon">📊</div>
                        <h3>No Historical Data</h3>
                        <p>Track expenses over time to build your historical comparison.</p>
                    </div>
                ) : (
                    <div 
                        ref={scrollRef}
                        style={{ overflowX: 'auto', paddingBottom: '0.5rem' }}
                    >
                        <div style={{ minWidth: `${minWidth}px`, height: '280px' }}>
                            <Bar data={chartData} options={chartOptions} />
                        </div>
                    </div>
                )}
            </div>

            {/* Historical Savings Table */}
            <div className="table-card">
                <div className="table-header">
                    <h2 className="card-title">Monthly Breakdown Table</h2>
                </div>

                {history.length > 0 ? (
                    <div className="table-responsive">
                        <table className="data-table">
                            <thead>
                                <tr>
                                    <th scope="col">Month</th>
                                    <th scope="col" style={{ textAlign: 'right' }}>Monthly Income</th>
                                    <th scope="col" style={{ textAlign: 'right' }}>Money Spent</th>
                                    <th scope="col" style={{ textAlign: 'right' }}>Monthly Savings</th>
                                    <th scope="col" style={{ textAlign: 'right' }}>Savings Rate</th>
                                </tr>
                            </thead>
                            <tbody>
                                {history.map(row => {
                                    const rate = row.income > 0 ? Math.round((row.savings / row.income) * 100) : 0;
                                    const isPositive = row.savings >= 0;

                                    return (
                                        <tr key={row.month}>
                                            <td style={{ fontWeight: 600 }}>{row.month}</td>
                                            <td style={{ textAlign: 'right' }} className="num">{formatCurrency(row.income)}</td>
                                            <td style={{ textAlign: 'right' }} className="num">{formatCurrency(row.spent)}</td>
                                            <td style={{ textAlign: 'right', fontWeight: 700, color: isPositive ? 'var(--color-primary)' : 'var(--color-danger)' }} className="num">
                                                {isPositive ? '+' : '-'}{formatCurrency(row.savings)}
                                            </td>
                                            <td style={{ textAlign: 'right', fontWeight: 600, color: isPositive ? 'var(--color-primary)' : 'var(--color-danger)' }}>
                                                {rate}%
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                        <p>No monthly records available yet.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SavingsPage;
