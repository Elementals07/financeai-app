import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
    HiOutlineEnvelope,
    HiOutlineLockClosed,
    HiOutlineEye,
    HiOutlineEyeSlash,
    HiOutlineSparkles,
    HiOutlineUser
} from 'react-icons/hi2';
import toast from 'react-hot-toast';

const DEMO_EMAIL = 'demo@example.com';
const DEMO_PASS = 'demo@123';

const LoginForm = () => {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);
    const [demoLoading, setDemoLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const { login } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        if (!email.trim() || !password) {
            setErrorMsg('Please enter both email and password.');
            return;
        }
        setLoading(true);
        try {
            await login(email.trim(), password);
            toast.success('Welcome back!');
            navigate('/');
        } catch (err) {
            const msg = err.response?.data?.message || 'Invalid email or password. Please try again.';
            setErrorMsg(msg);
            toast.error(msg);
        } finally {
            setLoading(false);
        }
    };

    const handleDemoLogin = async () => {
        setErrorMsg('');
        setDemoLoading(true);
        try {
            await login(DEMO_EMAIL, DEMO_PASS);
            toast.success('Logged in as demo user');
            navigate('/');
        } catch (err) {
            setErrorMsg('Demo account login failed. You can create a new account below.');
            toast.error('Demo login failed');
        } finally {
            setDemoLoading(false);
        }
    };

    return (
        <div className="auth-container">
            <div className="auth-card">
                {/* Brand Header */}
                <div className="auth-header">
                    <div className="auth-logo-badge" aria-hidden="true">
                        <HiOutlineSparkles />
                    </div>
                    <h1 className="auth-title">FinanceAI</h1>
                    <p className="auth-subtitle">Sign in to your everyday ledger</p>
                </div>

                {/* One-click Demo Login box */}
                <div className="auth-demo-box">
                    <div>
                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                            Explore with Demo Account
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                            Preloaded with sample expenses and budgets
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleDemoLogin}
                        disabled={demoLoading || loading}
                        className="btn btn-secondary btn-sm"
                        style={{ flexShrink: 0 }}
                    >
                        {demoLoading ? 'Signing in...' : 'Try Demo'}
                    </button>
                </div>

                <div className="auth-divider">
                    <span>or sign in with email</span>
                </div>

                {/* Inline Error Message */}
                {errorMsg && (
                    <div className="status-banner danger" style={{ marginBottom: '1.25rem' }} role="alert">
                        <div className="status-banner-text">{errorMsg}</div>
                    </div>
                )}

                {/* Sign-In Form */}
                <form onSubmit={handleSubmit}>
                    <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                        <label htmlFor="login-email" className="form-label">
                            Email address
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', display: 'flex' }}>
                                <HiOutlineEnvelope aria-hidden="true" />
                            </span>
                            <input
                                id="login-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                className="form-input"
                                style={{ paddingLeft: '2.5rem' }}
                                autoComplete="email"
                                required
                            />
                        </div>
                    </div>

                    <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                        <label htmlFor="login-password" className="form-label">
                            Password
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', display: 'flex' }}>
                                <HiOutlineLockClosed aria-hidden="true" />
                            </span>
                            <input
                                id="login-password"
                                type={showPass ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter your password"
                                className="form-input"
                                style={{ paddingLeft: '2.5rem', paddingRight: '2.75rem' }}
                                autoComplete="current-password"
                                required
                            />
                            <button
                                type="button"
                                onClick={() => setShowPass(s => !s)}
                                aria-label={showPass ? 'Hide password' : 'Show password'}
                                style={{
                                    position: 'absolute',
                                    right: '8px',
                                    top: '50%',
                                    transform: 'translateY(-50%)',
                                    padding: '6px',
                                    color: 'var(--text-secondary)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center'
                                }}
                            >
                                {showPass ? <HiOutlineEyeSlash aria-hidden="true" /> : <HiOutlineEye aria-hidden="true" />}
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-lg"
                        disabled={loading || demoLoading}
                        style={{ width: '100%', marginBottom: '1.25rem' }}
                    >
                        {loading ? 'Signing in...' : 'Sign In'}
                    </button>
                </form>

                {/* Footer Switcher */}
                <div style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Don&apos;t have an account?{' '}
                    <Link to="/register" style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                        Create one here
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default LoginForm;
