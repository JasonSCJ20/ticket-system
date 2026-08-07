import { request, API_URL, getToken } from './client.js';

export const fetchMonthlyReport = () => request('/reports/monthly');
export const fetchExecutiveReport = () => request('/reports/executive');
export const fetchTechnicalReport = () => request('/reports/technical');

// Downloads a report export as a blob and saves it via a temporary <a
// download> click — the `request` helper always parses JSON, so PDF/CSV
// exports go straight through fetch with the same bearer-token auth header
// the rest of the app uses.
async function downloadFile(path, fallbackFilename) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
    });
  } catch {
    throw new Error(`Unable to reach the API at ${API_URL}. Check the backend URL and CORS configuration.`);
  }

  if (!response.ok) {
    const rawText = await response.text().catch(() => '');
    let body = {};
    if (rawText) {
      try {
        body = JSON.parse(rawText);
      } catch {
        body = {};
      }
    }
    const message =
      body.detail ||
      body.error ||
      (response.status === 403 ? "You don't have permission to download that report." : null) ||
      (response.status === 401 ? 'You need to sign in to do that.' : null) ||
      `Failed to download report (HTTP ${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  const blob = await response.blob();
  const disposition = response.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : fallbackFilename;

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const downloadExecutivePdf = () => downloadFile('/reports/executive/export.pdf', 'commandcentre-executive-report.pdf');
export const downloadTechnicalCsv = () => downloadFile('/reports/technical/export.csv', 'commandcentre-technical-report.csv');
