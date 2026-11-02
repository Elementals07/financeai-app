import { Doughnut } from 'react-chartjs-2';
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from 'chart.js';
import { useCategories } from '../../hooks/useCategories';

ChartJS.register(ArcElement, Tooltip, Legend);

const SpendingPieChart = ({ categoryBreakdown = [] }) => {
    const { colorMap } = useCategories();

    if (categoryBreakdown.length === 0) {
        return (
            <div className="card">
                <div className="card-header">
                    <div>
                        <h2 className="card-title">Where Your Money Went</h2>
                        <p className="card-subtitle">Spending breakdown by category</p>
                    </div>
                </div>
                <div className="empty-state" style={{ padding: '2.5rem 1rem' }}>
                    <div className="empty-state-icon">📊</div>
                    <h3>No Expenses Recorded Yet</h3>
                    <p>Add your first expense to see your category breakdown.</p>
                </div>
            </div>
        );
    }

    const totalSpending = categoryBreakdown.reduce((sum, c) => sum + c.total, 0);

    const data = {
        labels: categoryBreakdown.map(c => c.category),
        datasets: [{
            data: categoryBreakdown.map(c => c.total),
            backgroundColor: categoryBreakdown.map(c => colorMap[c.category] || '#69736C'),
            borderColor: '#FFFFFF',
            borderWidth: 2,
            hoverOffset: 6,
            spacing: 2,
            borderRadius: 3
        }]
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
            legend: {
                display: false
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
                    label: (ctx) => {
                        const value = ctx.parsed;
                        const pct = totalSpending > 0 ? Math.round((value / totalSpending) * 100) : 0;
                        return ` ₹${value.toLocaleString('en-IN')} (${pct}%)`;
                    }
                }
            }
        }
    };

    return (
        <div className="card">
            <div className="card-header">
                <div>
                    <h2 className="card-title">Where Your Money Went</h2>
                    <p className="card-subtitle">Spending breakdown by category this month</p>
                </div>
            </div>
            {/* Responsive, centered doughnut */}
            <div className="spending-chart-wrap">
                <Doughnut data={data} options={options} />
            </div>

            {/* Custom centered HTML chips legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '8px', padding: '0 4px' }}>
                {categoryBreakdown.map(c => (
                    <div key={c.category} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-secondary)' }}>
                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: colorMap[c.category] || '#69736C', flexShrink: 0 }} />
                        <span>{c.category}</span>
                    </div>
                ))}
            </div>

            {/* Accessible screen-reader & visual summary list */}
            <div className="sr-only">
                <h4>Category Breakdown Summary</h4>
                <ul>
                    {categoryBreakdown.map(c => (
                        <li key={c.category}>
                            {c.category}: ₹{c.total.toLocaleString('en-IN')} ({totalSpending > 0 ? Math.round((c.total / totalSpending) * 100) : 0}%)
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
};

export default SpendingPieChart;
