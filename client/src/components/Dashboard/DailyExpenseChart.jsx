import { useState } from 'react';
import { Line } from 'react-chartjs-2';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Filler,
    Tooltip,
    Legend
} from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

const DailyExpenseChart = ({ dailySpending = [], currentMonth }) => {
    const [zoomView, setZoomView] = useState('all'); // 'all', '14d', '7d'

    const getDaysInMonth = () => {
        if (!currentMonth) return [];
        const [year, month] = currentMonth.split('-').map(Number);
        const daysCount = new Date(year, month, 0).getDate();
        
        const days = [];
        for (let i = 1; i <= daysCount; i++) {
            const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
            days.push(dateStr);
        }
        return days;
    };

    let allDays = getDaysInMonth();
    if (zoomView === '7d') {
        allDays = allDays.slice(-7);
    } else if (zoomView === '14d') {
        allDays = allDays.slice(-14);
    }
    
    const spendingMap = dailySpending.reduce((acc, curr) => {
        acc[curr.day] = curr.total;
        return acc;
    }, {});

    const labels = allDays.map(day => parseInt(day.split('-')[2], 10));
    const chartData = allDays.map(day => spendingMap[day] || 0);

    if (allDays.length === 0 || dailySpending.length === 0) {
        return (
            <div className="card">
                <div className="card-header">
                    <div>
                        <h2 className="card-title">Daily Spending Pattern</h2>
                        <p className="card-subtitle">Spending day-by-day this month</p>
                    </div>
                </div>
                <div className="empty-state" style={{ padding: '2.5rem 1rem' }}>
                    <div className="empty-state-icon">📆</div>
                    <h3>No Daily Expenses Yet</h3>
                    <p>Transactions will appear here as you log them throughout the month.</p>
                </div>
            </div>
        );
    }

    const data = {
        labels,
        datasets: [{
            label: 'Daily Spent',
            data: chartData,
            borderColor: '#0EA5C9',
            backgroundColor: (ctx) => {
                const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 240);
                gradient.addColorStop(0, 'rgba(14, 165, 201, 0.16)');
                gradient.addColorStop(1, 'rgba(14, 165, 201, 0.01)');
                return gradient;
            },
            fill: true,
            tension: 0.25,
            borderWidth: 2,
            pointRadius: (ctx) => (ctx.raw > 0 ? 3.5 : 0),
            pointBackgroundColor: '#0EA5C9',
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 1.5,
            pointHoverRadius: 6,
            pointHoverBorderWidth: 2
        }]
    };

    const options = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
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
                    title: (ctx) => `Day ${ctx[0].label}`,
                    label: (ctx) => ` Spent: ₹${ctx.parsed.y.toLocaleString('en-IN')}`
                }
            }
        },
        scales: {
            x: {
                grid: { display: false },
                ticks: {
                    color: '#69736C',
                    font: { family: '"DM Sans", sans-serif', size: 11 },
                    maxTicksLimit: 16
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

    return (
        <div className="card">
            {/* Heading + Zoom toggles */}
            <div className="card-header daily-chart-header" style={{ alignItems: 'flex-start' }}>
                <div>
                    <h2 className="card-title">Daily Spending Pattern</h2>
                    <p className="card-subtitle">Day-by-day spending spikes and activity</p>
                </div>
                <div className="daily-chart-controls" style={{ display: 'flex', gap: '4px', background: 'var(--bg-surface-subtle)', padding: '2px', borderRadius: 'var(--radius-full)', border: '1px solid var(--border-color)' }}>
                    <button
                        type="button"
                        onClick={() => setZoomView('7d')}
                        style={{
                            padding: '2px 8px',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            borderRadius: 'var(--radius-full)',
                            background: zoomView === '7d' ? 'var(--color-primary)' : 'transparent',
                            color: zoomView === '7d' ? '#FFFFFF' : 'var(--text-secondary)',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        7D
                    </button>
                    <button
                        type="button"
                        onClick={() => setZoomView('14d')}
                        style={{
                            padding: '2px 8px',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            borderRadius: 'var(--radius-full)',
                            background: zoomView === '14d' ? 'var(--color-primary)' : 'transparent',
                            color: zoomView === '14d' ? '#FFFFFF' : 'var(--text-secondary)',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        14D
                    </button>
                    <button
                        type="button"
                        onClick={() => setZoomView('all')}
                        style={{
                            padding: '2px 8px',
                            fontSize: '0.6875rem',
                            fontWeight: 700,
                            borderRadius: 'var(--radius-full)',
                            background: zoomView === 'all' ? 'var(--color-primary)' : 'transparent',
                            color: zoomView === 'all' ? '#FFFFFF' : 'var(--text-secondary)',
                            border: 'none',
                            cursor: 'pointer'
                        }}
                    >
                        Month
                    </button>
                </div>
            </div>
            {/* Full-width responsive chart; remount on filter changes to resize cleanly */}
            <div className="daily-chart-wrap" style={{ marginTop: '0.5rem' }}>
                <Line key={zoomView} data={data} options={options} />
            </div>
        </div>
    );
};

export default DailyExpenseChart;
