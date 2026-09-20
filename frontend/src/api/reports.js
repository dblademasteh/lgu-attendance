import { api } from './client.js';

export const daily = (params) => api.get('/reports/daily', { params }).then((r) => r.data);
export const summary = (params) => api.get('/reports/summary', { params }).then((r) => r.data);
export const timesheet = (employeeId, params) => api.get(`/reports/timesheet/${employeeId}`, { params }).then((r) => r.data);
export const exportCsvUrl = '/reports/export';
