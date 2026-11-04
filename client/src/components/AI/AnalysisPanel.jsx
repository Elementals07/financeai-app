import { useState, useEffect, useCallback } from 'react';
import API from '../../api/axios';
import { HiOutlineSparkles, HiOutlineArrowPath, HiOutlineExclamationTriangle } from 'react-icons/hi2';
import toast from 'react-hot-toast';
import { AdvisorMarkdown } from '../../utils/advisorFormatter';

const HEALTH_CONFIG = {
    green: {
        bannerClass: 'good',
        label: 'Finances look healthy within your plan',
    },
    yellow: {
        bannerClass: 'warning',
        label: 'Some spending areas need attention',
    },
    red: {
        bannerClass: 'danger',
        label: 'Action needed — spending is off track',
    }
};

const AnalysisPanel = () => {
    const [analysis, setAnalysis] = useState(null);
    const [signal, setSignal] = useState('green');
    const [timeframe, setTimeframe] = useState('month');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    const fetchAnalysis = useCallback(async (forceRefresh = false) => {
        setLoading(true);
        setError(null);
        try {
            const res = await API.post('/ai/analyze', {
                refresh: forceRefresh
            });
            const data = res.data?.data;
            if (!data?.analysis) {
                throw new Error('The AI returned an empty analysis. Please try again.');
            }
            setAnalysis(data.analysis);
            setSignal(data.healthSignal || 'green');
        } catch (err) {
            setError(err.response?.data?.message || err.message || 'Could not load analysis. Please check your data or try again.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchAnalysis();
    }, [fetchAnalysis, timeframe]);

    const handleRefresh = () => {
        fetchAnalysis(true);
        toast.success('Refreshing analysis with latest spending data...');
    };

    const health = HEALTH_CONFIG[signal] || HEALTH_CONFIG.green;

    return (
        <div className="card analysis-panel-card" style={{ display: 'flex', flexDirection: 'column', padding: 0, overflow: 'hidden' }}>
            {/* Header — sticky, never scrolls */}
            <div className="card-header" style={{ paddingBottom: '0.75rem', borderBottom: '1px solid var(--border-color)', flexShrink: 0, padding: '1rem 1.25rem 0.75rem' }}>
                <div>
                    <h2 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                        <HiOutlineSparkles style={{ color: 'var(--color-primary)' }} />
                        Spending Diagnosis
                    </h2>
                    <p className="card-subtitle">Practical assessment of your real financial habits</p>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <select
                        value={timeframe}
                        onChange={(e) => setTimeframe(e.target.value)}
                        className="form-select"
                        style={{ minHeight: '36px', padding: '0.2rem 0.5rem', fontSize: '0.8125rem', width: 'auto' }}
                        aria-label="Select diagnosis timeframe"
                    >
                        <option value="month">This Month</option>
                        <option value="quarter">Last 3 Months</option>
                        <option value="year">All Time</option>
                    </select>

                    <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={handleRefresh}
                        disabled={loading}
                        title="Re-run analysis"
                        aria-label="Refresh spending analysis"
                    >
                        <HiOutlineArrowPath className={loading ? 'spinner' : ''} aria-hidden="true" />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {/* Content Body — only this region scrolls */}
            <div style={{ flex: 1, padding: '1rem 1.25rem', overflowY: 'auto', minHeight: 0, WebkitOverflowScrolling: 'touch' }}>
                {loading ? (
                    <div>
                        <div className="loading-skeleton" style={{ height: '40px', marginBottom: '1rem', borderRadius: 'var(--radius-sm)' }} />
                        <div className="loading-skeleton" style={{ height: '80px', marginBottom: '1rem', borderRadius: 'var(--radius-sm)' }} />
                        <div className="loading-skeleton" style={{ height: '140px', borderRadius: 'var(--radius-sm)' }} />
                    </div>
                ) : error ? (
                    <div className="empty-state" style={{ padding: '2rem 1rem' }}>
                        <div className="empty-state-icon">⚠️</div>
                        <h3>Diagnosis Unavailable</h3>
                        <p>{error}</p>
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => fetchAnalysis(false)}>
                            Try Again
                        </button>
                    </div>
                ) : analysis ? (
                    <div>
                        {/* Health Signal Banner */}
                        <div className={`status-banner ${health.bannerClass}`} style={{ marginBottom: '1.25rem' }}>
                            <div className="status-banner-text">
                                <strong>Financial Health Signal:</strong> {health.label}
                            </div>
                        </div>

                        {/* Safely Rendered Structured Markdown */}
                        <AdvisorMarkdown content={analysis} />
                    </div>
                ) : (
                    <div className="empty-state">
                        <div className="empty-state-icon">💡</div>
                        <h3>No Analysis Generated Yet</h3>
                        <p>Click below to generate an AI assessment of your spending and receive personalized next steps.</p>
                        <button type="button" className="btn btn-primary" onClick={() => fetchAnalysis(true)}>
                            Generate Diagnosis
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AnalysisPanel;
