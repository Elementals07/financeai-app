import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { AuthProvider, useAuth } from './context/AuthContext';
import Layout from './components/Layout/Layout';
import DashboardPage from './pages/DashboardPage';
import ExpensesPage from './pages/ExpensesPage';
import BudgetPage from './pages/BudgetPage';
import AIInsightsPage from './pages/AIInsightsPage';
import CategoriesPage from './pages/CategoriesPage';
import SavingsPage from './pages/SavingsPage';
import GuidePage from './pages/GuidePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import './App.css';

/** Protected Route wrapper — redirects to login if not authenticated */
const ProtectedRoute = ({ children }) => {
    const { isAuthenticated, loading } = useAuth();
    
    if (loading) {
        return (
            <div style={{ 
                minHeight: '100vh', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                backgroundColor: 'var(--bg-primary, #F5F7FF)'
            }}>
                <div className="spinner" aria-label="Loading..." />
            </div>
        );
    }

    return isAuthenticated ? children : <Navigate to="/login" replace />;
};

/** Public Route wrapper — redirects to dashboard if already authenticated */
const PublicRoute = ({ children }) => {
    const { isAuthenticated, loading } = useAuth();
    
    if (loading) {
        return (
            <div style={{ 
                minHeight: '100vh', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                backgroundColor: 'var(--bg-primary, #F5F7FF)'
            }}>
                <div className="spinner" aria-label="Loading..." />
            </div>
        );
    }

    return isAuthenticated ? <Navigate to="/" replace /> : children;
};

function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <Toaster
                    position="top-right"
                    toastOptions={{
                        duration: 3200,
                        style: {
                            background: '#FFFFFF',
                            color: '#111827',
                            border: '1px solid #DDE2F0',
                            borderRadius: '8px',
                            fontSize: '0.92rem',
                            fontFamily: '"DM Sans", -apple-system, BlinkMacSystemFont, sans-serif',
                            boxShadow: '0 4px 16px rgba(37, 45, 41, 0.08)',
                            padding: '12px 16px'
                        },
                        success: {
                            iconTheme: { primary: '#2D3FBF', secondary: '#FFFFFF' }
                        },
                        error: {
                            iconTheme: { primary: '#DC2626', secondary: '#FFFFFF' }
                        }
                    }}
                />
                <Routes>
                    {/* Public Routes */}
                    <Route path="/login" element={<PublicRoute><LoginPage /></PublicRoute>} />
                    <Route path="/register" element={<PublicRoute><RegisterPage /></PublicRoute>} />

                    {/* Protected Routes inside Global Layout */}
                    <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                        <Route index element={<DashboardPage />} />
                        <Route path="expenses" element={<ExpensesPage />} />
                        <Route path="budget" element={<BudgetPage />} />
                        {/* Both /sectors (legacy bookmark) and /categories supported */}
                        <Route path="sectors" element={<CategoriesPage />} />
                        <Route path="categories" element={<CategoriesPage />} />
                        <Route path="savings" element={<SavingsPage />} />
                        {/* Both /ai-insights and /ai-advisor supported */}
                        <Route path="ai-insights" element={<AIInsightsPage />} />
                        <Route path="ai-advisor" element={<AIInsightsPage />} />
                        <Route path="guide" element={<GuidePage />} />
                    </Route>

                    {/* Catch-all */}
                    <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
            </AuthProvider>
        </BrowserRouter>
    );
}

export default App;
