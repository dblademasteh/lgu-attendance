import { api } from './client.js';

export const login = (username, password) => api.post('/auth/login', { username, password }).then((r) => r.data);
export const refresh = (refreshToken) => api.post('/auth/refresh', { refreshToken }).then((r) => r.data);
export const me = () => api.get('/auth/me', { headers: {} }).then((r) => r.data);
