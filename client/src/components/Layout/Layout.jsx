import { useState, useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import BottomNav from './BottomNav';
import { HiOutlineSparkles } from 'react-icons/hi2';
import { useAuth } from '../../context/AuthContext';

const Layout = () => {
    const { user } = useAuth();
    const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
        try { 
            return localStorage.getItem('sidebar-collapsed') === 'true'; 
        } catch { 
            return false; 
        }
    });
    const [mobileOpen, setMobileOpen] = useState(false);

    useEffect(() => {
        const handler = (e) => setSidebarCollapsed(e.detail.collapsed);
        window.addEventListener('sidebarToggle', handler);
        return () => window.removeEventListener('sidebarToggle', handler);
    }, []);

    const getInitials = (name) => {
        if (!name) return '?';
        return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    };

    return (
        <div className="app-layout">
            {/* Sidebar / More Drawer (desktop sidebar, mobile slide-over drawer) */}
            <Sidebar 
                mobileOpen={mobileOpen} 
                onCloseMobile={() => setMobileOpen(false)} 
            />

            {/* Mobile Backdrop Overlay */}
            {mobileOpen && (
                <div 
                    className="mobile-overlay" 
                    onClick={() => setMobileOpen(false)} 
                    aria-hidden="true" 
                />
            )}

            {/* Main Content Area */}
            <main 
                className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
                id="main-content"
                role="main"
            >
                {/* Mobile Native App Bar (full width, fixed at top of main content) */}
                <header className="mobile-header" role="banner">
                    <div className="mobile-brand">
                        <div className="mobile-brand-icon" aria-hidden="true">
                            <HiOutlineSparkles />
                        </div>
                        <span className="mobile-brand-text">FinanceAI</span>
                    </div>

                    <div className="mobile-header-actions">
                        <button 
                            type="button" 
                            className="mobile-avatar-btn" 
                            onClick={() => setMobileOpen(true)}
                            aria-label="Open menu and settings"
                        >
                            <div className="mobile-avatar" title={user?.name || 'User'}>
                                {getInitials(user?.name)}
                            </div>
                        </button>
                    </div>
                </header>

                <div className="page-wrapper">
                    <Outlet />
                </div>
            </main>

            {/* Native Mobile Bottom Navigation Bar */}
            <BottomNav />
        </div>
    );
};

export default Layout;
