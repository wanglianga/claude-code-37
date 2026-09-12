<template>
  <div class="login-bg">
    <el-card class="login-card">
      <div class="brand">🏫 城市社区临时托管自习室</div>
      <div class="subtitle">预约与安全巡查平台</div>
      <el-form :model="form" @keyup.enter="submit">
        <el-form-item>
          <el-input v-model="form.username" size="large" placeholder="用户名" :prefix-icon="User" />
        </el-form-item>
        <el-form-item>
          <el-input v-model="form.password" type="password" size="large" placeholder="密码" :prefix-icon="Lock" show-password />
        </el-form-item>
        <el-button type="primary" size="large" style="width:100%" :loading="loading" @click="submit">登 录</el-button>
      </el-form>
      <el-divider>演示账号（点击快速填充）</el-divider>
      <div class="accounts">
        <el-tag v-for="a in accounts" :key="a.u" class="acc" :type="a.type" effect="plain"
                @click="fill(a.u, a.p)">
          {{ a.label }}：{{ a.u }} / {{ a.p }}
        </el-tag>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { User, Lock } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { useAuth } from '../store';

const router = useRouter();
const auth = useAuth();
const form = reactive({ username: '', password: '' });
const loading = ref(false);

const accounts = [
  { label: '社区负责人', u: 'admin', p: 'admin123', type: 'danger' },
  { label: '社区工作人员', u: 'staff', p: 'staff123', type: 'warning' },
  { label: '志愿者', u: 'volunteer', p: 'vol123', type: 'success' },
  { label: '安保', u: 'security', p: 'sec123', type: 'primary' },
  { label: '家长', u: 'parent1', p: 'parent123', type: 'info' },
];
function fill(u: string, p: string) { form.username = u; form.password = p; }

async function submit() {
  if (!form.username || !form.password) return ElMessage.warning('请输入用户名和密码');
  loading.value = true;
  try {
    const res: any = await api.post('/auth/login', form);
    auth.setSession(res.token, res.user);
    ElMessage.success(`欢迎，${res.user.name}`);
    router.push(res.user.role === 'parent' ? '/parent' : '/desk');
  } finally {
    loading.value = false;
  }
}
</script>

<style scoped>
.login-bg { height:100vh; display:flex; align-items:center; justify-content:center;
  background: linear-gradient(135deg,#2b5876,#4e4376); }
.login-card { width:430px; padding:10px 14px; }
.brand { font-size:20px; font-weight:700; text-align:center; }
.subtitle { text-align:center; color:#888; margin:6px 0 22px; }
.accounts { display:flex; flex-wrap:wrap; gap:8px; }
.acc { cursor:pointer; }
</style>
