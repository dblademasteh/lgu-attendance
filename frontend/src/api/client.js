import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4100/api/v1';

export { API_BASE };

export const api = axios.create({
  baseURL: API_BASE,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const auth = JSON.parse(localStorage.getItem('lgu-attendance-auth') || '{}');
  if (auth.accessToken) {
    config.headers.Authorization = `Bearer ${auth.accessToken}`;
  }
  if (config.params) {
    const cleaned = Object.fromEntries(
      Object.entries(config.params).filter(([, v]) => v !== '' && v !== undefined && v !== null)
    );
    config.params = cleaned;
  }
  return config;
});

// Single-flight refresh: parallel 401s (dashboard fires several at once)
// share one refresh call instead of stampeding /auth/refresh (mirrors lgu-hrms).
let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const auth = JSON.parse(localStorage.getItem('lgu-attendance-auth') || '{}');
      if (auth.refreshToken) {
        try {
          if (!refreshPromise) {
            refreshPromise = axios
              .post(`${API_BASE}/auth/refresh`, {
                refreshToken: JSON.parse(localStorage.getItem('lgu-attendance-auth') || '{}').refreshToken,
              })
              .then((res) => res.data.accessToken)
              .finally(() => {
                refreshPromise = null;
              });
          }
          const newToken = await refreshPromise;
          localStorage.setItem('lgu-attendance-auth', JSON.stringify({ ...auth, accessToken: newToken }));
          original.headers.Authorization = `Bearer ${newToken}`;
          return api(original);
        } catch (e) {
          // Only drop the session when the refresh token itself is rejected.
          // Transient backend errors (500/network) keep the session so a
          // retry can succeed once the server recovers.
          const status = e?.response?.status;
          if (status === 401 || status === 400 || status === 403) {
            localStorage.removeItem('lgu-attendance-auth');
            window.location.href = '/';
          }
        }
      }
    }
    return Promise.reject(error);
  }
);
