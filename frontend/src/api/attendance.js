import { api } from './client.js';

export const list = (params) => api.get('/attendance', { params }).then((r) => r.data);
export const today = (department) => api.get('/attendance/today', { params: { department } }).then((r) => r.data);
export const myToday = () => api.get('/attendance/my').then((r) => r.data);
export const myHistory = (month) => api.get('/attendance/my/history', { params: { month } }).then((r) => r.data);
export const punch = (data) => api.post('/attendance/punch', data).then((r) => r.data);
export const punchManual = (data) => api.post('/attendance/punch-manual', data).then((r) => r.data);
export const markAbsent = (date) => api.post('/attendance/mark-absent', { date }).then((r) => r.data);
export const correct = (id, data) => api.patch(`/attendance/${id}`, data).then((r) => r.data);
export const getGeofenceConfig = () => api.get('/attendance/rule/geofence').then((r) => r.data);
export const updateGeofenceConfig = (data) => api.patch('/attendance/rule/geofence', data).then((r) => r.data);
