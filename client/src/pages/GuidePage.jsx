import { useState } from 'react';
import { 
    HiOutlineCreditCard, 
    HiOutlineCamera, 
    HiOutlineBanknotes, 
    HiOutlineChartPie, 
    HiOutlineCircleStack, 
    HiOutlineSparkles,
    HiOutlineChevronDown,
    HiOutlineCheck,
    HiOutlineDevicePhoneMobile,
    HiOutlineArrowDownTray
} from 'react-icons/hi2';

const GUIDE_SECTIONS = [
    {
        id: 'mobile-app',
        icon: <HiOutlineDevicePhoneMobile aria-hidden="true" />,
        title: '📱 Use FinanceAI Directly on Your Mobile Phone',
        summary: 'Run FinanceAI directly on your phone as a native Android APK or Home Screen Web App.',
        steps: [
            'Method 1 (Android APK with Bank SMS Sync): Download FinanceAI.apk below or from GitHub Releases. Open it in your phone’s Files/Downloads app and tap "Install" (enable "Install unknown apps" if prompted).',
            'Method 2 (Android Chrome): Open this app URL in Google Chrome on your phone, tap the three-dots menu (⋮), and tap "Add to Home screen" or "Install App".',
            'Method 3 (iPhone Safari): Open this app URL in Safari, tap the Share icon (square with arrow), and tap "Add to Home Screen".',
            'Once installed, launch FinanceAI directly from your home screen like any native app. All data is saved on your device in Dexie/IndexedDB.'
        ],
        tip: 'The native Android APK allows direct Bank & UPI SMS inbox sync, while the Home Screen Web App works instantly on both Android and iPhone without sideloading.'
    },
    {
        id: 'add-expense',
        icon: <HiOutlineCreditCard aria-hidden="true" />,
        title: '1. Add an Expense',
        summary: 'Record money you spent in a matter of seconds.',
        steps: [
            'Click the green "Add Expense" button at the top of the Home or Expenses page.',
            'Type the amount in rupees (e.g. 250).',
            'Select a category like Food, Travel, or Utilities.',
            'Select the date (defaults to Today).',
            'Optionally add a note (e.g. "Lunch with friends") and tap "Save Expense".'
        ],
        tip: 'Entering expenses daily keeps your remaining spending buffer completely accurate.'
    },
    {
        id: 'scan-bill',
        icon: <HiOutlineCamera aria-hidden="true" />,
        title: '2. Scan a Bill or Receipt',
        summary: 'Take a picture of a receipt to automatically extract the details.',
        steps: [
            'Go to Expenses and click "Scan Bill".',
            'Choose a receipt photo from your device or take a new picture.',
            'Wait a few seconds while the reader extracts the merchant name, date, and amount.',
            'Review the extracted values and make any needed corrections.',
            'Confirm to save the transaction to your ledger.'
        ],
        tip: 'The scanner never saves anything without your explicit confirmation.'
    },
    {
        id: 'budget',
        icon: <HiOutlineBanknotes aria-hidden="true" />,
        title: '3. Create a Monthly Budget',
        summary: 'Set maximum limits for spending categories so you stay within your income.',
        steps: [
            'Open the Budget page from the sidebar menu.',
            'Enter your expected monthly take-home income.',
            'Assign spending limits for categories (e.g. Food: ₹8,000, Rent: ₹15,000).',
            'Review the unallocated amount to see how much is left over.',
            'Click "Save Spending Plan" to save your targets.'
        ],
        tip: 'If your planned category limits exceed your monthly income, the app will give you a friendly warning before saving.'
    },
    {
        id: 'dashboard',
        icon: <HiOutlineChartPie aria-hidden="true" />,
        title: '4. Understand Your Dashboard',
        summary: 'See your complete financial picture at a glance.',
        steps: [
            'Check "Money Left in Spending Plan" to see how much you have left to spend this month.',
            'Review the Budget Status banner: "Good" (within plan), "Warning" (near limit), or "Exceeded" (over plan).',
            'See your top spending category to immediately spot where the most money went.',
            'Browse your recent expenses and daily spending spikes.'
        ],
        tip: 'Your saved balance shows income minus recorded expenses for the month. It is not an actual bank account balance.'
    },
    {
        id: 'savings',
        icon: <HiOutlineCircleStack aria-hidden="true" />,
        title: '5. Track Your Savings History',
        summary: 'See how much money you retained month-over-month.',
        steps: [
            'Navigate to "My Savings" in the sidebar.',
            'View your Total Savings across all months recorded so far.',
            'Check your Average Monthly Savings run-rate.',
            'Inspect the monthly comparison chart to see your income versus expenses over time.'
        ],
        tip: 'Consistent positive surplus month after month builds long-term financial security.'
    },
    {
        id: 'ai-advisor',
        icon: <HiOutlineSparkles aria-hidden="true" />,
        title: '6. Ask the AI Advisor',
        summary: 'Get personalized, practical guidance grounded in your real numbers.',
        steps: [
            'Go to "AI Advisor" in the sidebar.',
            'Read the Spending Diagnosis panel for a quick health check of your habits.',
            'In the chat panel, click a suggested question like "Where did my money go?" or "What should I reduce?".',
            'Read the structured response outlining what happened, why it matters, and next steps.'
        ],
        tip: 'The advisor strictly looks at your recorded numbers and never makes assumptions about external accounts.'
    }
];

const GuidePage = () => {
    const [openSection, setOpenSection] = useState('mobile-app');

    const toggleSection = (id) => {
        setOpenSection(prev => prev === id ? null : id);
    };

    return (
        <div style={{ maxWidth: '900px', margin: '0 auto' }}>
            {/* Page Header */}
            <div className="page-header">
                <div className="page-tag">
                    User Guide & Mobile Setup
                </div>
                <h1 className="page-title">How to Use & Install FinanceAI</h1>
                <p className="page-subtitle">
                    Run natively on your mobile phone or follow step-by-step instructions for everyday tasks.
                </p>
            </div>

            {/* Quick Mobile Action Banner */}
            <div className="card mb-6" style={{ background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(59, 130, 246, 0.08) 100%)', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                        <div className="w-10 h-10 rounded-lg bg-emerald-600 text-white flex items-center justify-center shrink-0 text-xl shadow-sm">
                            <HiOutlineDevicePhoneMobile aria-hidden="true" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-gray-900 dark:text-white">
                                Want to use FinanceAI directly on your phone?
                            </h2>
                            <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">
                                Download the production Android APK or install as a Web App directly on your mobile home screen.
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <a 
                            href="/api/download/apk"
                            download="FinanceAI.apk"
                            className="btn btn-primary inline-flex items-center gap-1.5 text-sm py-2 px-3.5 shadow-sm"
                        >
                            <HiOutlineArrowDownTray className="text-lg" aria-hidden="true" />
                            <span>Download APK (Android)</span>
                        </a>
                    </div>
                </div>
            </div>

            {/* Step-by-Step Accordion Sections */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
                {GUIDE_SECTIONS.map((sec) => {
                    const isOpen = openSection === sec.id;

                    return (
                        <div 
                            key={sec.id} 
                            className="card"
                            style={{ 
                                padding: 0,
                                border: isOpen ? '1px solid var(--color-primary)' : '1px solid var(--border-color)',
                                overflow: 'hidden'
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => toggleSection(sec.id)}
                                aria-expanded={isOpen}
                                style={{
                                    width: '100%',
                                    padding: '1.25rem 1.5rem',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: '1rem',
                                    textAlign: 'left',
                                    backgroundColor: isOpen ? 'var(--color-primary-subtle)' : 'var(--bg-surface)',
                                    transition: 'background-color var(--transition-fast)'
                                }}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                                    <div style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: 'var(--radius-sm)',
                                        backgroundColor: isOpen ? 'var(--color-primary)' : 'var(--bg-surface-subtle)',
                                        color: isOpen ? '#FFFFFF' : 'var(--color-primary)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '1.25rem',
                                        flexShrink: 0
                                    }}>
                                        {sec.icon}
                                    </div>
                                    <div>
                                        <h2 style={{ fontSize: '1.0625rem', fontWeight: 700, margin: 0, color: 'var(--text-primary)' }}>
                                            {sec.title}
                                        </h2>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
                                            {sec.summary}
                                        </p>
                                    </div>
                                </div>

                                <HiOutlineChevronDown 
                                    style={{
                                        fontSize: '1.25rem',
                                        color: 'var(--text-secondary)',
                                        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                        transition: 'transform var(--transition-fast)',
                                        flexShrink: 0
                                    }}
                                    aria-hidden="true"
                                />
                            </button>

                            {isOpen && (
                                <div style={{ padding: '1.25rem 1.5rem 1.5rem', borderTop: '1px solid var(--border-color)', backgroundColor: 'var(--bg-surface)' }}>
                                    <div style={{ marginBottom: '1.25rem' }}>
                                        <div style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.75rem' }}>
                                            Steps to follow:
                                        </div>
                                        <ol style={{ paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.9375rem', color: 'var(--text-primary)' }}>
                                            {sec.steps.map((st, i) => (
                                                <li key={i} style={{ lineHeight: 1.5 }}>
                                                    {st}
                                                </li>
                                            ))}
                                        </ol>
                                    </div>

                                    {sec.tip && (
                                        <div className="status-banner good" style={{ margin: 0 }}>
                                            <HiOutlineCheck className="status-banner-icon" aria-hidden="true" />
                                            <div className="status-banner-text">
                                                <strong>Helpful Tip:</strong> {sec.tip}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

export default GuidePage;
