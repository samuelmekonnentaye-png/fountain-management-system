import axios from 'axios';

export const TOKEN_KEY = 'fit_token';

const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api' });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const url = err.config?.url || '';
    if (err.response?.status === 401 && !url.includes('/auth/login') && !url.includes('/auth/register')) {
      localStorage.removeItem(TOKEN_KEY);
      window.dispatchEvent(new Event('auth:logout'));
    }
    return Promise.reject(err);
  }
);

export const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';

// Downloads a file (Excel) through the authenticated API.
export async function download(path, params, fallbackName) {
  const res = await api.get(path, { params, responseType: 'blob' });
  const cd = res.headers['content-disposition'] || '';
  const m = /filename="?([^";]+)"?/.exec(cd);
  const url = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = url;
  a.download = m ? m[1] : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default api;
