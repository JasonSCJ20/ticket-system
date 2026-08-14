import { request, downloadFile } from './client.js';

export const fetchMonthlyReport = () => request('/reports/monthly');
export const fetchExecutiveReport = () => request('/reports/executive');
export const fetchTechnicalReport = () => request('/reports/technical');

export const downloadExecutivePdf = () => downloadFile('/reports/executive/export.pdf', 'commandcentre-executive-report.pdf');
export const downloadTechnicalCsv = () => downloadFile('/reports/technical/export.csv', 'commandcentre-technical-report.csv');
