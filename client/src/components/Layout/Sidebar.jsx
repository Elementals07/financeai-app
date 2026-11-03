import { useState, useEffect } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import GeminiSettingsModal from '../AI/GeminiSettingsModal';
import { getGeminiKeyCount, MAX_GEMINI_KEYS } from '../../services/geminiKeys';
import { 
    HiOutlineHome, 
    HiOutlineCreditCard, 
    HiOutlineBanknotes,
    HiOutlineSparkles,
    HiOutlineArrowRightOnRectangle,
    HiOutlineCircleStack,
    HiOutlineTag,
    HiOutlineQuestionMarkCircle,
    HiOutlineChevronLeft,
    HiOutlineChevronRight,
    HiOutlineXMark
} from 'react-icons/hi2';

const Sidebar = ({ mobileOpen, onCloseMobile }) => {
    const { user, logout } = useAuth();
    const navigate = useNavigate();
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [keyCount, setKeyCount] = useState(() => getGeminiKeyCount());

    // Default to open (not collapsed) on desktop as per UX guidelines
    const [collapsed, setCollapsed] = useState(() => {
        try { 
            return localStorage.getItem('sidebar-collapsed') === 'true'; 
        } catch { 
            return false; 
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('sidebar-collapsed', String(collapsed));
        } catch (e) {
            console.error(e);
        }
        window.dispatchEvent(new CustomEvent('sidebarToggle', { detail: { collapsed } }));
    }, [collapsed]);

    // Handle Escape key on mobile to close drawer
    useEffect(() => {
        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && mobileOpen) {
                onCloseMobile();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [mobileOpen, onCloseMobile]);

    const handleLogout = () => { 
        logout(); 
        navigate('/login'); 
    };

    const handleOpenSettings = () => {
        setSettingsOpen(true);
        onCloseMobile();
    };

    const getInitials = (name) => {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    // Public navigation items matching Everyday Ledger guidelines
    const navSections = [
        { 
            section: 'Daily Finances', 
            items: [
                { to: '/', end: true, icon: <HiOutlineHome aria-hidden="true" />, label: 'Home' },
                { to: '/expenses', icon: <HiOutlineCreditCard aria-hidden="true" />, label: 'Expenses' },
                { to: '/budget', icon: <HiOutlineBanknotes aria-hidden="true" />, label: 'Budget' },
            ]
        },
        { 
            section: 'Planning & Insights', 
            items: [
                { to: '/savings', icon: <HiOutlineCircleStack aria-hidden="true" />, label: 'My Savings' },
                { to: '/sectors', icon: <HiOutlineTag aria-hidden="true" />, label: 'Categories' },
                { to: '/ai-insights', icon: <HiOutlineSparkles aria-hidden="true" />, label: 'AI Advisor' },
                { to: '/guide', icon: <HiOutlineQuestionMarkCircle aria-hidden="true" />, label: 'How to Use' },
            ]
        },
    ];

    return (
        <>
        <aside 
            className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`}
            aria-label="Main Navigation"
        >
            {/* Brand Header */}
            <div className="sidebar-header">
                <div className="sidebar-brand">
                    <div className="sidebar-brand-icon" aria-hidden="true">
                        <HiOutlineSparkles />
                    </div>
                    {!collapsed && (
                        <div className="sidebar-brand-text">
                            <h2>FinanceAI</h2>
                            <span>Everyday Ledger</span>
                        </div>
                    )}
                </div>
                
                {/* Desktop Collapse / Expand Toggle */}
                <button 
                    type="button"
                    className="sidebar-collapse-btn"
                    onClick={() => setCollapsed(c => !c)}
                    title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
                    aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
                >
                    {collapsed ? <HiOutlineChevronRight aria-hidden="true" /> : <HiOutlineChevronLeft aria-hidden="true" />}
                </button>

                {/* Mobile Drawer Close Button */}
                <button
                    type="button"
                    className="sidebar-mobile-close"
                    onClick={onCloseMobile}
                    aria-label="Close navigation menu"
                >
                    <HiOutlineXMark aria-hidden="true" />
                </button>
            </div>

            {/* Navigation links */}
            <nav className="sidebar-nav">
                {navSections.map(({ section, items }) => (
                    <div key={section} style={{ marginBottom: '0.5rem' }}>
                        {!collapsed && <div className="sidebar-section-title">{section}</div>}
                        {items.map(({ to, end, icon, label }) => (
                            <NavLink
                                key={to}
                                to={to}
                                end={end}
                                onClick={onCloseMobile}
                                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                                title={collapsed ? label : undefined}
                                aria-label={label}
                            >
                                <span className="nav-icon">{icon}</span>
                                {!collapsed && <span className="nav-item-label">{label}</span>}
                            </NavLink>
                        ))}
                    </div>
                ))}

                <div style={{ marginBottom: '0.5rem' }}>
                    {!collapsed && <div className="sidebar-section-title">App</div>}
                    <button
                        type="button"
                        className="nav-item"
                        onClick={handleOpenSettings}
                        title={collapsed ? 'AI Settings' : undefined}
                        aria-label={`AI Settings, ${keyCount} of ${MAX_GEMINI_KEYS} keys configured`}
                        aria-haspopup="dialog"
                        aria-expanded={settingsOpen}
                        style={{
                            width: '100%',
                            background: 'transparent',
                            cursor: 'pointer',
                            textAlign: 'left',
                            fontFamily: 'inherit'
                        }}
                    >
                        <span className="nav-icon"><HiOutlineSparkles aria-hidden="true" /></span>
                        {!collapsed && (
                            <>
                                <span className="nav-item-label">AI Settings</span>
                                <span
                                    style={{
                                        marginLeft: 'auto',
                                        fontSize: '0.75rem',
                                        fontWeight: 600,
                                        color: keyCount > 0 ? 'var(--color-primary)' : 'var(--color-danger)'
                                    }}
                                >
                                    {keyCount}/{MAX_GEMINI_KEYS}
                                </span>
                            </>
                        )}
                    </button>
                </div>
            </nav>

            {/* User Footer */}
            <div className="sidebar-footer">
                <div className="sidebar-user" title={collapsed ? `${user?.name || 'Account'} (${user?.email || ''})` : undefined}>
                    <div className="sidebar-avatar" aria-hidden="true">
                        {getInitials(user?.name)}
                    </div>
                    {!collapsed && (
                        <>
                            <div className="sidebar-user-info">
                                <div className="sidebar-user-name">{user?.name || 'My Account'}</div>
                                <div className="sidebar-user-email">{user?.email || ''}</div>
                            </div>
                            <button 
                                type="button"
                                className="btn-logout" 
                                onClick={handleLogout} 
                                title="Sign out of account"
                                aria-label="Sign out"
                            >
                                <HiOutlineArrowRightOnRectangle aria-hidden="true" />
                            </button>
                        </>
                    )}
                </div>
                {collapsed && (
                    <button 
                        type="button"
                        className="btn-logout" 
                        onClick={handleLogout} 
                        title="Sign out of account" 
                        aria-label="Sign out"
                        style={{ width: '100%', marginTop: '0.35rem' }}
                    >
                        <HiOutlineArrowRightOnRectangle aria-hidden="true" />
                    </button>
                )}
            </div>
        </aside>

        {settingsOpen && (
            <GeminiSettingsModal
                onClose={() => setSettingsOpen(false)}
                onSaved={(keys) => setKeyCount(keys.length)}
            />
        )}
        </>
    );
};

export default Sidebar;
