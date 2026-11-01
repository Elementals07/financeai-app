import { useState, useEffect } from 'react';
import { Outlet, Link } from 'react-router-dom';
import Sidebar from './Sidebar';
import { HiOutlineBars3, HiOutlineSparkles } from 'react-icons/hi2';
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
            {/* Mobile Header Bar (visible on narrow screens < 900px) */}
            <header className="mobile-header" role="banner">
                <button 
                    type="button" 
                    className="mobile-menu-btn" 
                    onClick={() => setMobileOpen(true)}
                    aria-label="Open navigation menu"
                    aria-expanded={mobileOpen}
                >
                    <HiOutlineBars3 aria-hidden="true" />
                </button>

                <div className="mobile-brand">
                    <div className="mobile-brand-icon" aria-hidden="true">
                        <HiOutlineSparkles />
                    </div>
                    <span className="mobile-brand-text">FinanceAI</span>
                </div>

                <div className="mobile-avatar" title={user?.name || 'User'} aria-label={`Logged in as ${user?.name || 'User'}`}>
                    {getInitials(user?.name)}
                </div>
            </header>

            {/* Mobile Backdrop Overlay */}
            {mobileOpen && (
                <div 
                    className="mobile-overlay" 
                    onClick={() => setMobileOpen(false)}
                    aria-hidden="true" 
                />
            )}

            {/* Sidebar Component */}
            <Sidebar 
                mobileOpen={mobileOpen} 
                onCloseMobile={() => setMobileOpen(false)} 
            />

            {/* Main Content Area */}
            <main 
                className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}
                id="main-content"
                role="main"
            >
                <div className="page-wrapper">
                    <Outlet />
                </div>
            </main>
        </div>
    );
};

export default Layout;
