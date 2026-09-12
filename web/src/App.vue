<template>
  <el-container v-if="auth.isLogin" style="height:100vh">
    <el-aside width="220px" class="aside">
      <div class="logo">🏫 自习室看护平台</div>
      <el-menu :default-active="$route.path" router background-color="#1f2d3d" text-color="#c8d3e0"
               active-text-color="#ffd04b">
        <el-menu-item v-if="auth.role==='parent'" index="/parent">
          <el-icon><Calendar /></el-icon><span>我的预约</span>
        </el-menu-item>
        <template v-if="['staff','volunteer','admin','security'].includes(auth.role)">
          <el-menu-item index="/desk"><el-icon><Checked /></el-icon><span>今日工作台</span></el-menu-item>
          <el-menu-item index="/seats" v-if="['staff','volunteer','admin'].includes(auth.role)">
            <el-icon><Grid /></el-icon><span>座位图</span>
          </el-menu-item>
          <el-menu-item index="/patrols" v-if="['security','staff','admin'].includes(auth.role)">
            <el-icon><View /></el-icon><span>安全巡查</span>
          </el-menu-item>
        </template>
        <el-menu-item index="/incidents"><el-icon><Warning /></el-icon><span>协同事件</span></el-menu-item>
        <el-menu-item index="/timeline"><el-icon><Clock /></el-icon><span>看护时间线</span></el-menu-item>
        <template v-if="['staff','admin','volunteer','security'].includes(auth.role)">
          <el-menu-item index="/archive"><el-icon><Folder /></el-icon><span>当日档案</span></el-menu-item>
          <el-menu-item index="/watchlist"><el-icon><Star /></el-icon><span>重点关注名单</span></el-menu-item>
        </template>
        <template v-if="['staff','admin'].includes(auth.role)">
          <el-menu-item index="/weekly"><el-icon><TrendCharts /></el-icon><span>周统计与决策</span></el-menu-item>
          <el-menu-item index="/settings"><el-icon><Setting /></el-icon><span>开放与排班</span></el-menu-item>
        </template>
      </el-menu>
    </el-aside>
    <el-container>
      <el-header class="header">
        <div class="title">{{ pageTitle }}</div>
        <div>
          <el-tag type="info" effect="plain" style="margin-right:12px">{{ ROLE_LABEL[auth.role] }}</el-tag>
          <span style="margin-right:16px">{{ auth.user?.name }}</span>
          <el-button size="small" @click="logout">退出</el-button>
        </div>
      </el-header>
      <el-main class="main"><router-view /></el-main>
    </el-container>
  </el-container>
  <router-view v-else />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuth, ROLE_LABEL } from './store';

const auth = useAuth();
const route = useRoute();
const router = useRouter();
const titles: Record<string, string> = {
  '/parent': '家长 · 预约与看护动态',
  '/desk': '工作人员 · 今日工作台（入场核验 / 自习记录 / 离场）',
  '/seats': '座位分配图（低龄 / 安静 / 临窗 / 监控覆盖）',
  '/incidents': '跨角色协同事件处置',
  '/patrols': '安全巡查记录',
  '/timeline': '当日看护时间线（入场→座位→巡查→异常→离场证据链）',
  '/archive': '当日档案',
  '/weekly': '周统计与开放决策',
  '/watchlist': '重点关注学生名单',
  '/settings': '社区开放时间与志愿者排班',
};
const pageTitle = computed(() => titles[route.path] || '社区临时托管自习室平台');
function logout() {
  auth.logout();
  router.push('/login');
}
</script>

<style>
html, body, #app { margin: 0; height: 100%; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; }
.aside { background: #1f2d3d; overflow-y: auto; }
.logo { color: #fff; font-weight: 700; font-size: 16px; padding: 18px 16px; line-height: 1.4; }
.aside .el-menu { border-right: none; }
.header { display: flex; align-items: center; justify-content: space-between; background: #fff; border-bottom: 1px solid #e8e8e8; }
.header .title { font-weight: 600; font-size: 16px; }
.main { background: #f2f4f7; padding: 18px; }
.card-title { font-weight: 600; margin-bottom: 12px; }
</style>
