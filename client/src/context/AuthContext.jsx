/**
 * Auth Context
 * Manages authentication state across the app with unified session handling.
 *
 * The authenticated account is tracked explicitly via `auth_user_id`; there is
 * no fallback to the first database record (the demo account never silently
 * becomes the current user).
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import API from '../api/axios';
import {
    getStoredToken,
    getStoredUserId,
    getStoredUser,
    setStoredToken,
    setStoredUser,
    setStoredUserId,
    clearSession
} from '../services/authSession';
import { SESSION_EXPIRED_MESSAGE } from '../services/localExpenseService';

const AuthContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(() => getStoredUser());
    const [token, setToken] = useState(() => getStoredToken());
    const [loading, setLoading] = useState(true);

    // Synchronize 401 logout events from API interceptor
    useEffect(() => {
        const handleUnauthorized = () => {
            clearSession();
            setToken(null);
            setUser(null);
        };
        window.addEventListener('auth:unauthorized', handleUnauthorized);
        return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
    }, []);

    // On mount or token change, verify user session.
    // Restore only from BOTH token + auth_user_id, and only accept /auth/me
    // results that match the stored id.
    useEffect(() => {
        let isMounted = true;
        const initAuth = async () => {
            const currentToken = getStoredToken();
            const currentUserId = getStoredUserId();

            if (currentToken) {
                try {
                    if (currentUserId) {
                        const res = await API.get('/auth/me');
                        const restoredUser = res?.data?.data;
                        if (isMounted && restoredUser && Number(restoredUser.id) === Number(currentUserId)) {
                            setUser(restoredUser);
                            setStoredUser(restoredUser);
                        } else if (isMounted) {
                            clearSession();
                            setToken(null);
                            setUser(null);
                        }
                    } else if (isMounted) {
                        // Token without an explicit user id: stale session.
                        clearSession();
                        setToken(null);
                        setUser(null);
                    }
                } catch {
                    if (isMounted) {
                        clearSession();
                        setToken(null);
                        setUser(null);
                    }
                }
            } else {
                if (isMounted) {
                    clearSession();
                    setUser(null);
                }
            }
            if (isMounted) {
                setLoading(false);
            }
        };

        initAuth();
        return () => {
            isMounted = false;
        };
    }, [token]);

    const login = async (email, password) => {
        const res = await API.post('/auth/login', { email, password });
        const { token: newToken, user: userData } = res.data.data || {};
        if (!newToken || !userData) {
            throw new Error(SESSION_EXPIRED_MESSAGE);
        }
        setStoredToken(newToken);
        setStoredUser(userData);
        setStoredUserId(userData.id);
        setToken(newToken);
        setUser(userData);
        return userData;
    };

    const loginDemo = async () => {
        const res = await API.post('/auth/demo', {});
        const { token: newToken, user: userData } = res.data.data || {};
        if (!newToken || !userData) {
            throw new Error('The demo account is unavailable. Please restart the app and try again.');
        }
        setStoredToken(newToken);
        setStoredUser(userData);
        setStoredUserId(userData.id);
        setToken(newToken);
        setUser(userData);
        return userData;
    };

    const register = async (name, email, password) => {
        const res = await API.post('/auth/register', { name, email, password });
        const { token: newToken, user: userData } = res.data.data || {};
        if (!newToken || !userData) {
            throw new Error(SESSION_EXPIRED_MESSAGE);
        }
        setStoredToken(newToken);
        setStoredUser(userData);
        setStoredUserId(userData.id);
        setToken(newToken);
        setUser(userData);
        return userData;
    };

    const logout = useCallback(() => {
        clearSession();
        setToken(null);
        setUser(null);
    }, []);

    const updateUser = useCallback((userData) => {
        setUser(prev => {
            const next = { ...prev, ...userData };
            try {
                setStoredUser(next);
            } catch (e) {
                console.error('Failed to persist user update', e);
            }
            return next;
        });
    }, []);

    const value = {
        user,
        token,
        loading,
        isAuthenticated: !!token && !!user,
        login,
        loginDemo,
        register,
        logout,
        updateUser
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export default AuthContext;
