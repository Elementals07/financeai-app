import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
    HiOutlineUser,
    HiOutlineEnvelope,
    HiOutlineLockClosed,
    HiOutlineEye,
    HiOutlineEyeSlash,
    HiOutlineSparkles
} from 'react-icons/hi2';
import toast from 'react-hot-toast';

const RegisterForm = () => {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');
    const { register } = useAuth();
    const navigate = useNavigate();

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg('');

        if (!name.trim() || !email.trim() || !password) {
            setErrorMsg('Please fill in all required fields.');
            return;
        }

        if (password.length < 6) {
            setErrorMsg('Password must be at least 6 characters long.');
            return;
        }

        if (password !== confirmPassword) {
            setErrorMsg('Passwords do not match. Please re-type password.');
            return;
        }

        setLoading(true);
        try {
            await register(name.trim(), email.trim(), password);
            toast.success('Account created successfully!');
            navigate('/');
        } catch (err) {
            const msg = err.response?.data?.message || 'Registration failed. An account with this email may already exist.';
            setErrorMsg(msg);
            toast.error(msg);
        } finally {
            setLoading(false);
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
                    <h1 className="auth-title">Create Account</h1>
                    <p className="auth-subtitle">Start tracking your everyday ledger today</p>
                </div>

                {/* Inline Error State */}
                {errorMsg && (
                    <div className="status-banner danger" style={{ marginBottom: '1.25rem' }} role="alert">
                        <div className="status-banner-text">{errorMsg}</div>
                    </div>
                )}

                <form onSubmit={handleSubmit}>
                    {/* Name */}
                    <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                        <label htmlFor="reg-name" className="form-label">
                            Full Name
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', display: 'flex' }}>
                                <HiOutlineUser aria-hidden="true" />
                            </span>
                            <input
                                id="reg-name"
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="e.g. Alex Sharma"
                                className="form-input"
                                style={{ paddingLeft: '2.5rem' }}
                                autoComplete="name"
                                required
                            />
                        </div>
                    </div>

                    {/* Email */}
                    <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                        <label htmlFor="reg-email" className="form-label">
                            Email address
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', display: 'flex' }}>
                                <HiOutlineEnvelope aria-hidden="true" />
                            </span>
                            <input
                                id="reg-email"
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

                    {/* Password */}
                    <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                        <label htmlFor="reg-password" className="form-label">
                            Password (minimum 6 characters)
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', display: 'flex' }}>
                                <HiOutlineLockClosed aria-hidden="true" />
                            </span>
                            <input
                                id="reg-password"
                                type={showPass ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Create a password"
                                className="form-input"
                                style={{ paddingLeft: '2.5rem', paddingRight: '2.75rem' }}
                                autoComplete="new-password"
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

                    {/* Confirm Password */}
                    <div className="form-group" style={{ marginBottom: '1.5rem' }}>
                        <label htmlFor="reg-confirm-password" className="form-label">
                            Confirm Password
                        </label>
                        <div style={{ position: 'relative' }}>
                            <span style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)', display: 'flex' }}>
                                <HiOutlineLockClosed aria-hidden="true" />
                            </span>
                            <input
                                id="reg-confirm-password"
                                type={showPass ? 'text' : 'password'}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Re-enter your password"
                                className="form-input"
                                style={{ paddingLeft: '2.5rem' }}
                                autoComplete="new-password"
                                required
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        className="btn btn-primary btn-lg"
                        disabled={loading}
                        style={{ width: '100%', marginBottom: '1.25rem' }}
                    >
                        {loading ? 'Creating account...' : 'Create Account'}
                    </button>
                </form>

                {/* Footer Switcher */}
                <div style={{ textAlign: 'center', fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                    Already have an account?{' '}
                    <Link to="/login" style={{ fontWeight: 600, color: 'var(--color-primary)' }}>
                        Sign in here
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default RegisterForm;
