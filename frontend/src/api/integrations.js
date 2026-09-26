import { api } from './client.js';

export const list = () => api.get('/integrations').then((r) => r.data);
export const get = (id) => api.get(`/integrations/${id}`).then((r) => r.data);
export const create = (data) => api.post('/integrations', data).then((r) => r.data);
export const update = (id, data) => api.patch(`/integrations/${id}`, data).then((r) => r.data);
export const remove = (id) => api.delete(`/integrations/${id}`).then((r) => r.data);
export const test = (id, data) => api.post(`/integrations/${id}/test`, data ?? {}).then((r) => r.data);
export const run = (id) => api.post(`/integrations/${id}/run`).then((r) => r.data);
