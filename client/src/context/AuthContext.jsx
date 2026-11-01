/**
 * Auth Context
 * Manages authentication state across the app with unified session handling
 */
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import API from '../api/axios';

const AuthContext = createContext(null);

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (!context) throw new Error('useAuth must be used within AuthProvider');
    return context;
};

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(() => {
        try {
            const saved = localStorage.getItem('user');
            return saved ? JSON.parse(saved) : null;
        } catch {
            return null;
        }
    });
    const [token, setToken] = useState(() => localStorage.getItem('token'));
    const [loading, setLoading] = useState(true);

    // Synchronize 401 logout events from API interceptor
    useEffect(() => {
        const handleUnauthorized = () => {
            setToken(null);
            setUser(null);
        };
        window.addEventListener('auth:unauthorized', handleUnauthorized);
        return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
    }, []);

    // On mount or token change, verify user session
    useEffect(() => {
        let isMounted = true;
        const initAuth = async () => {
            const currentToken = localStorage.getItem('token');
            if (currentToken) {
                try {
                    const res = await API.get('/auth/me');
                    if (isMounted) {
                        setUser(res.data.data);
                        localStorage.setItem('user', JSON.stringify(res.data.data));
                    }
                } catch (err) {
                    if (isMounted) {
                        localStorage.removeItem('token');
                        localStorage.removeItem('user');
                        setToken(null);
                        setUser(null);
                    }
                }
            } else {
                if (isMounted) {
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
        const { token: newToken, user: userData } = res.data.data;
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(userData));
        setToken(newToken);
        setUser(userData);
        return userData;
    };

    const register = async (name, email, password) => {
        const res = await API.post('/auth/register', { name, email, password });
        const { token: newToken, user: userData } = res.data.data;
        localStorage.setItem('token', newToken);
        localStorage.setItem('user', JSON.stringify(userData));
        setToken(newToken);
        setUser(userData);
        return userData;
    };

    const logout = useCallback(() => {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        setToken(null);
        setUser(null);
    }, []);

    const updateUser = useCallback((userData) => {
        setUser(prev => {
            const next = { ...prev, ...userData };
            try {
                localStorage.setItem('user', JSON.stringify(next));
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
