import { useState } from 'react';
import AnalysisPanel from '../components/AI/AnalysisPanel';
import ChatAssistant from '../components/AI/ChatAssistant';
import { HiOutlineSparkles, HiOutlineChatBubbleLeftRight } from 'react-icons/hi2';

const AIInsightsPage = () => {
    const [mobileTab, setMobileTab] = useState('analysis'); // 'analysis' or 'chat'

    return (
        <div className="ai-insights-page">
            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '1rem' }}>
                <div className="page-tag">
                    AI Guidance
                </div>
                <h1 className="page-title">AI Advisor</h1>
                <p className="page-subtitle">
                    Financial diagnosis and conversation grounded in your recorded transactions.
                </p>

                {/* Mobile Segmented Tab Switcher (< 768px) */}
                <div className="ai-mobile-tabs" role="tablist" aria-label="AI Views">
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mobileTab === 'analysis'}
                        className={`ai-tab-btn ${mobileTab === 'analysis' ? 'active' : ''}`}
                        onClick={() => setMobileTab('analysis')}
                    >
                        <HiOutlineSparkles aria-hidden="true" />
                        <span>Spending Diagnosis</span>
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={mobileTab === 'chat'}
                        className={`ai-tab-btn ${mobileTab === 'chat' ? 'active' : ''}`}
                        onClick={() => setMobileTab('chat')}
                    >
                        <HiOutlineChatBubbleLeftRight aria-hidden="true" />
                        <span>Chat Assistant</span>
                    </button>
                </div>
            </div>

            {/* Content Container: Segmented on mobile, side-by-side grid on desktop */}
            <div className="ai-panels-container">
                <div className={`ai-panel-wrapper ${mobileTab === 'analysis' ? 'mobile-visible' : 'mobile-hidden'}`}>
                    <AnalysisPanel />
                </div>
                <div className={`ai-panel-wrapper ${mobileTab === 'chat' ? 'mobile-visible' : 'mobile-hidden'}`}>
                    <ChatAssistant />
                </div>
            </div>
        </div>
    );
};

export default AIInsightsPage;
