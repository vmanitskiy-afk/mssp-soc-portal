import { create } from 'zustand';
import api from '../services/api';
import type { UserInfo } from '../types';

interface AuthState {
  user: UserInfo | null;
  isLoading: boolean;
  isAuthenticated: boolean;

  login: (email: string, password: string) => Promise<{ requires_mfa: boolean; temp_token?: string }>;
  verifyMFA: (tempToken: string, code: string) => Promise<void>;
  logout: () => void;
  fetchUser: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isLoading: true,
  isAuthenticated: !!localStorage.getItem('access_token'),

  login: async (email, password) => {
    const { data } = await api.post('/auth/login', { email, password });
    if (!data.requires_mfa && data.access_token) {
      localStorage.setItem('access_token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);
      set({ isAuthenticated: true });
      // Fetch user info
      const me = await api.get('/auth/me');
      set({ user: me.data });
    }
    return data;
  },

  verifyMFA: async (tempToken, code) => {
    const { data } = await api.post('/auth/mfa/verify', {
      temp_token: tempToken,
      otp_code: code,
    });
    localStorage.setItem('access_token', data.access_token);
    localStorage.setItem('refresh_token', data.refresh_token);
    set({ isAuthenticated: true });
    const me = await api.get('/auth/me');
    set({ user: me.data });
  },

  logout: () => {
    localStorage.clear();
    set({ user: null, isAuthenticated: false });
    window.location.href = '/login';
  },

  fetchUser: async () => {
    try {
      const { data } = await api.get('/auth/me');
      set({ user: data, isAuthenticated: true, isLoading: false });
    } catch {
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));
