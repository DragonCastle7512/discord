import { token } from './state.js';

async function request(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  const separator = url.includes('?') ? '&' : '?';
  const finalUrl = `${url}${separator}token=${token}`;

  try {
    const res = await fetch(finalUrl, { ...options, headers });
    if (res.status === 401) {
      alert('토큰이 만료되었습니다. Discord에서 /dashboard 명령어를 다시 입력해주세요.');
      throw new Error('Unauthorized');
    }
    const data = await res.json();
    return data;
  } catch (err) {
    console.error(`API Error (${url}):`, err);
    throw err;
  }
}

export const api = {
  fetchDashboardData: (type) => request(`/api/dashboard-data?type=${type}`),
  sendControl: (action) => request('/api/control', { method: 'POST', body: JSON.stringify({ action }) }),
  playMusic: (url) => request('/api/play-music', { method: 'POST', body: JSON.stringify({ url }) }),
  moveItem: (type, from, to) => request('/api/move-item', { method: 'POST', body: JSON.stringify({ type, from, to }) }),
  deleteItem: (type, index) => request('/api/delete-item', { method: 'POST', body: JSON.stringify({ type, index }) }),
  fetchKeywords: (mode) => request(`/api/admin/keywords?mode=${mode}`),
  addBlacklist: (keyword, mode) => request('/api/admin/blacklist', { method: 'POST', body: JSON.stringify({ keyword, mode }) }),
  removeBlacklist: (keyword, mode) => request('/api/admin/blacklist', { method: 'DELETE', body: JSON.stringify({ keyword, mode }) }),
  searchPreview: (keyword) => request(`/api/admin/search-preview?keyword=${encodeURIComponent(keyword)}`),
};
