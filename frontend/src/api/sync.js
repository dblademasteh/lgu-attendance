import { api } from './client.js';

export const status = () => api.get('/sync/status').then((r) => r.data);
export const logs = (params) => api.get('/sync/logs', { params }).then((r) => r.data);
export const run = (integrationId) => api.post('/sync/run', integrationId ? { integrationId } : {}).then((r) => r.data);
