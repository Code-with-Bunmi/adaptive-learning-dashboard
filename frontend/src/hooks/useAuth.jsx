import React, { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../services/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(localStorage.getItem('aldash_session'));
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .me(token)
      .then(({ user }) => setUser(user))
      .catch(() => {
        localStorage.removeItem('aldash_session');
        setToken(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  /** Called with the one-time authorization `code` from the Google Identity Services popup
   *  (see pages/Login.jsx's useGoogleLogin call). We never touch a password — the code is
   *  exchanged server-side, and role is determined by the backend querying Classroom itself. */
  const loginWithGoogleCode = async (code) => {
    const { token, user } = await api.googleLogin(code);
    localStorage.setItem('aldash_session', token);
    setToken(token);
    setUser(user);
    return user;
  };

  /** Dev-only bypass (see backend/src/middleware/devLoginGuard.js — hard-404s outside
   *  development). Only ever called from a UI element itself gated on import.meta.env.DEV. */
  const loginAsDevUser = async (email) => {
    const { token, user } = await api.devLogin(email);
    localStorage.setItem('aldash_session', token);
    setToken(token);
    setUser(user);
    return user;
  };

  const logout = async () => {
    try {
      if (token) await api.logout(token);
    } catch {
      // stateless JWT — logout is best-effort server-side, always clear locally regardless
    }
    localStorage.removeItem('aldash_session');
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, loading, loginWithGoogleCode, loginAsDevUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
