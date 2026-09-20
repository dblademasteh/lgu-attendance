import { api } from './client.js';

export const list = (params) => api.get('/employees', { params }).then((r) => r.data);
export const get = (id) => api.get(`/employees/${id}`).then((r) => r.data);
export const create = (data) => api.post('/employees', data).then((r) => r.data);
export const update = (id, data) => api.patch(`/employees/${id}`, data).then((r) => r.data);
