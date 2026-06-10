// frontend/src/hooks/useAuth.jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../utils/api.js';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // Charge l'utilisateur depuis le token stocké
  useEffect(() => {
    const token = localStorage.getItem('safari_token');
    if (!token) { setLoading(false); return; }
    api.get('/auth/me')
      .then(data => setUser(data.user))
      .catch(() => localStorage.removeItem('safari_token'))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (firstName, lastName, password) => {
    const data = await api.post('/auth/login', { firstName, lastName, password });
    localStorage.setItem('safari_token', data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const register = useCallback(async (firstName, lastName, password) => {
    const data = await api.post('/auth/register', { firstName, lastName, password });
    localStorage.setItem('safari_token', data.token);
    setUser(data.user);
    return data.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('safari_token');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
