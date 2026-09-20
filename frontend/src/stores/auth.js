import { create } from 'zustand';

const AUTH_KEY = 'lgu-attendance-auth';

function readAuth() {
  try {
    return JSON.parse(localStorage.getItem(AUTH_KEY) || '{}');
  } catch {
    return {};
  }
}

export const useAuth = create((set) => ({
  user: readAuth().user ?? null,
  accessToken: readAuth().accessToken ?? null,
  setSession: ({ user, accessToken, refreshToken }) => {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ user, accessToken, refreshToken }));
    set({ user, accessToken });
  },
  logout: () => {
    localStorage.removeItem(AUTH_KEY);
    set({ user: null, accessToken: null });
  },
}));
