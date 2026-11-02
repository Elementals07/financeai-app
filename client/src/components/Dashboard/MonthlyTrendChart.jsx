import { Line } from 'react-chartjs-2';
import { useRef, useEffect } from 'react';
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

const MonthlyTrendChart = ({ trends = [] }) => {
    const scrollRef = useRef(null);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
        }
    }, [trends]);

    if (trends.length === 0) {
        return (
            <div className="card">
                <div className="card-header">
                    <div>
                        <h2 className="card-title">Spending Over Time</h2>
                        <p className="card-subtitle">Monthly spending history</p>
                    </div>
                </div>
                <div className="empty-state" style={{ padding: '2.5rem 1rem' }}>
                    <div className="empty-state-icon">📈</div>
                    <h3>No Trend Data Yet</h3>
                    <p>Track your spending over multiple months to see your long-term pattern.</p>
                </div>
            </div>
        );
    }

    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const labels = trends.map((t, index) => {
        const [y, m] = t.month.split('-');
        const monthName = monthNames[parseInt(m, 10) - 1];
        const previousYear = index > 0 ? trends[index - 1].month.split('-')[0] : null;
        return y !== previousYear ? `${monthName} ${y}` : monthName;
    });

    const data = {
        labels,
        datasets: [{
            label: 'Monthly Spending',
            data: trends.map(t => t.total),
            borderColor: '#2D3FBF',
            backgroundColor: (ctx) => {
                const gradient = ctx.chart.ctx.createLinearGradient(0, 0, 0, 240);
                gradient.addColorStop(0, 'rgba(45, 63, 191, 0.15)');
                gradient.addColorStop(1, 'rgba(45, 63, 191, 0.01)');
                return gradient;
            },
            fill: true,
            tension: 0.3,
            borderWidth: 2,
            pointRadius: 4,
            pointBackgroundColor: '#2D3FBF',
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 2,
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
                    label: (ctx) => ` Spent: ₹${ctx.parsed.y.toLocaleString('en-IN')}`
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

    return (
        <div className="card">
            {/* Heading stays fixed above the scrollable chart area */}
            <div className="card-header">
                <div>
                    <h2 className="card-title">Spending Over Time</h2>
                    <p className="card-subtitle">Month-by-month spending trajectory</p>
                </div>
            </div>
            {/* Horizontally scrollable — auto-scrolls to the most recent month */}
            <div
                ref={scrollRef}
                className="chart-scroll-x"
                style={{ marginTop: '0.5rem' }}
            >
                <div style={{ minWidth: `${Math.max(320, trends.length * 60)}px`, height: '240px', position: 'relative' }}>
                    <Line data={data} options={options} />
                </div>
            </div>
        </div>
    );
};

export default MonthlyTrendChart;
