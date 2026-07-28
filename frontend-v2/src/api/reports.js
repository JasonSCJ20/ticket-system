import { request } from './client.js';

export const fetchMonthlyReport = () => request('/reports/monthly');
export const fetchExecutiveReport = () => request('/reports/executive');
export const fetchTechnicalReport = () => request('/reports/technical');
