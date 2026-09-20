import { api } from './client.js';

export const list = () => api.get('/api-keys').then((r) => r.data);
export const create = (data) => api.post('/api-keys', data).then((r) => r.data);
export const remove = (id) => api.delete(`/api-keys/${id}`).then((r) => r.data);
