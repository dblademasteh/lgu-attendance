import { api } from './client.js';

export const status = () => api.get('/sync/status').then((r) => r.data);
export const logs = (params) => api.get('/sync/logs', { params }).then((r) => r.data);
export const run = () => api.post('/sync/run').then((r) => r.data);
export const getConfig = () => api.get('/sync/config').then((r) => r.data);
export const updateConfig = (data) => api.patch('/sync/config', data).then((r) => r.data);
export const testConnection = (data) => api.post('/sync/test', data ?? {}).then((r) => r.data);
