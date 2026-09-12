<template>
  <el-card>
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div class="card-title" style="margin:0">🪑 阳光社区自习室座位图（{{ meta.today }}）</div>
      <div>
        <el-tag effect="plain" class="legend" v-for="(label,key) in ZONE_LABEL" :key="key"
          :style="{background: zoneColor(key)}">{{ label }}</el-tag>
        <el-tag type="success" effect="dark" class="legend">已占用</el-tag>
        <el-tag type="info" effect="plain" class="legend">空闲</el-tag>
        <el-tag type="warning" effect="plain" class="legend">非监控位</el-tag>
      </div>
    </div>

    <div v-for="(label,key) in ZONE_LABEL" :key="key" class="zone">
      <div class="zone-name" :style="{color: zoneColorText(key)}">
        {{ label }}
        <span class="muted">（{{ zoneHint(key) }}）</span>
      </div>
      <div class="seat-row">
        <div v-for="s in seatsByZone[key]" :key="s.id" class="seat"
             :class="{occupied: !!s.reservation, unmonitored: !s.monitored}"
             @click="show(s)">
          <div class="code">{{ s.code }}</div>
          <div class="cam">{{ s.monitored ? '📹' : '🚫📹' }}</div>
          <div class="who">{{ occupant(s) }}</div>
        </div>
      </div>
    </div>
    <el-alert type="info" :closable="false" style="margin-top:14px"
      title="分配规则：低年级（1-3 年级）优先低龄陪护区；申请安静优先安静区；其余优先临窗区；所有区域优先监控覆盖座位，监控位满后才使用非监控位。" />
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { ZONE_LABEL } from '../store';

const meta = ref<any>({ seats: [], students: [] });
const seatsByZone = ref<Record<string, any[]>>({ junior: [], quiet: [], window: [], general: [] });
const studentMap = ref<Record<number, any>>({});

function zoneColor(z: string) {
  return { junior: '#fde2e4', quiet: '#e2eafc', window: '#d8f3dc', general: '#f0f0f0' }[z] || '#fff';
}
function zoneColorText(z: string) {
  return { junior: '#c9184a', quiet: '#1d4ed8', window: '#2d6a4f', general: '#666' }[z] || '#333';
}
function zoneHint(z: string) {
  return { junior: '靠近陪护志愿者，低龄学生优先', quiet: '独立自习需求', window: '采光临窗，普通学生优先', general: '常规座位' }[z] || '';
}
function occupant(s: any) {
  if (!s.reservation) return '空闲';
  const st = studentMap.value[s.reservation.studentId];
  return st ? st.name : '已预约';
}
function show(s: any) {
  if (!s.reservation) return ElMessage.info(`${s.code}：空闲${s.monitored ? '（监控覆盖）' : '（无监控）'}`);
  const st = studentMap.value[s.reservation.studentId];
  ElMessage({
    message: `${s.code}：${st?.name || ''}（${st?.grade} 年级）— 状态 ${s.reservation.status}`,
    type: st?.watchlisted ? 'error' : 'success',
  });
}

onMounted(async () => {
  meta.value = await api.get('/meta');
  for (const z of Object.keys(seatsByZone.value)) seatsByZone.value[z] = [];
  for (const s of meta.value.seats) (seatsByZone.value[s.zone] ||= []).push(s);
  for (const st of meta.value.students) studentMap.value[st.id] = st;
});
</script>

<style scoped>
.legend { margin-left:6px; }
.zone { margin-top:18px; }
.zone-name { font-weight:700; margin-bottom:8px; }
.seat-row { display:flex; gap:10px; flex-wrap:wrap; }
.seat { width:92px; border:1px solid #c8c9cc; border-radius:8px; padding:8px; text-align:center; cursor:pointer;
  background:#fafafa; transition:.15s; }
.seat:hover { transform:translateY(-2px); box-shadow:0 3px 8px rgba(0,0,0,.12); }
.seat.occupied { background:#e7f7ec; border-color:#67c23a; }
.seat.unmonitored { border-style:dashed; }
.code { font-weight:700; }
.cam { font-size:13px; margin:2px 0; }
.who { font-size:12px; color:#555; min-height:16px; }
.muted { color:#999; font-weight:400; font-size:12px; }
</style>
