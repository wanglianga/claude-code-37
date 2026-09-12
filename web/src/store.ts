import { defineStore } from 'pinia';

export const useAuth = defineStore('auth', {
  state: () => ({
    token: localStorage.getItem('token') || '',
    user: JSON.parse(localStorage.getItem('user') || 'null') as any,
  }),
  getters: {
    isLogin: (s) => !!s.token,
    role: (s) => s.user?.role || '',
  },
  actions: {
    setSession(token: string, user: any) {
      this.token = token;
      this.user = user;
      localStorage.setItem('token', token);
      localStorage.setItem('user', JSON.stringify(user));
    },
    logout() {
      this.token = '';
      this.user = null;
      localStorage.removeItem('token');
      localStorage.removeItem('user');
    },
  },
});

export const ROLE_LABEL: Record<string, string> = {
  parent: '家长',
  volunteer: '志愿者',
  staff: '社区工作人员',
  security: '安保',
  admin: '社区负责人',
};

export const INCIDENT_LABEL: Record<string, string> = {
  no_show: '学生未到',
  pickup_change: '家长临时改接',
  night_unpicked: '晚间无人接',
  conflict: '同学冲突',
  device_lost: '电子设备丢失',
  power_outage: '自习室临时停电',
  late_return: '晚归',
};

export const STATUS_LABEL: Record<string, string> = {
  pending: '待家长重新确认',
  confirmed: '待到店',
  checked_in: '自习中',
  checked_out: '已离场',
  no_show: '未到',
  cancelled: '已取消',
};

export const STATUS_TYPE: Record<string, string> = {
  pending: 'warning',
  confirmed: 'primary',
  checked_in: 'success',
  checked_out: 'info',
  no_show: 'danger',
  cancelled: 'info',
};

export const ZONE_LABEL: Record<string, string> = {
  junior: '低龄陪护区',
  quiet: '安静区',
  window: '临窗区',
  general: '普通区',
};
