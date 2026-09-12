import axios from 'axios';
import { ElMessage } from 'element-plus';

export const api = axios.create({ baseURL: '/api', timeout: 15000 });

api.interceptors.request.use(cfg => {
  const token = localStorage.getItem('token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

api.interceptors.response.use(
  res => res.data,
  err => {
    const msg = err.response?.data?.message || err.message || '请求失败';
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      if (location.hash !== '#/login') location.hash = '#/login';
    }
    ElMessage.error(Array.isArray(msg) ? msg.join('；') : msg);
    return Promise.reject(err);
  },
);
