import { api } from './client.js';

export const health = () => api.get('/health').then((r) => r.data);