<template>
  <el-card>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <div class="card-title" style="margin:0">🧭 当日看护时间线（入场 → 座位 → 巡查 → 异常 → 离场证据链）</div>
      <div>
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" size="small" @change="load" />
        <el-select v-model="studentId" size="small" clearable placeholder="全部学生" style="width:160px;margin-left:8px"
                   @change="load">
          <el-option v-for="s in students" :key="s.id" :label="s.name + '（' + s.grade + '年级）'" :value="s.id" />
        </el-select>
      </div>
    </div>

    <el-collapse v-model="active">
      <el-collapse-item v-for="s in data.students" :key="s.reservationId" :name="s.reservationId">
        <template #title>
          <b>{{ s.student?.name }}</b>
          <el-tag size="small" style="margin:0 8px" :type="STATUS_TYPE[s.status]">{{ STATUS_LABEL[s.status] }}</el-tag>
          <el-tag v-if="s.student?.watchlisted" type="danger" size="small" effect="dark">重点关注</el-tag>
          <span class="muted" style="margin-left:8px">{{ s.timeline.length }} 条看护记录</span>
        </template>
        <el-timeline>
          <el-timeline-item v-for="(t,i) in s.timeline" :key="i"
            :timestamp="new Date(t.time).toLocaleString('zh-CN')" placement="top"
            :type="kindType(t.kind, t)">
            <el-tag size="small" :type="kindTag(t.kind)">{{ kindLabel(t.kind) }}</el-tag>
            <el-tag size="small" type="info" style="margin:0 6px">{{ ROLE_LABEL[t.actorRole] }} · {{ t.actor }}</el-tag>
            <el-tag v-if="t.evidence" size="small" type="success">证据</el-tag>
            <el-tag v-if="t.abnormal" size="small" type="danger">异常</el-tag>
            <el-link v-if="t.incidentId" type="primary" style="margin-left:8px" @click="$router.push('/incidents')">
              打开协同事件 #{{ t.incidentId }}
            </el-link>
            <div style="margin-top:4px">{{ t.text }}</div>
          </el-timeline-item>
        </el-timeline>
      </el-collapse-item>
    </el-collapse>
    <el-empty v-if="!data.students?.length" description="当日暂无看护记录" />
  </el-card>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { ROLE_LABEL, STATUS_LABEL, STATUS_TYPE } from '../store';

const date = ref(new Date().toLocaleDateString('en-CA'));
const studentId = ref<number | undefined>(undefined);
const students = ref<any[]>([]);
const data = ref<any>({ students: [] });
const active = ref<number[]>([]);

function kindLabel(k: string) {
  return ({ checkin: '入场核验', seat: '座位分配', patrol: '安全巡查', event: '自习记录',
    incident: '协同事件', checkout: '离场登记', confirm: '家长确认' } as any)[k] || k;
}
function kindTag(k: string) {
  return ({ checkin: 'primary', seat: '', patrol: 'success', event: 'info', incident: 'danger',
    checkout: 'warning', confirm: 'success' } as any)[k] || 'info';
}
function kindType(k: string, t: any) {
  if (t.abnormal) return 'danger';
  return ({ checkin: 'primary', seat: '', patrol: 'success', event: 'info', incident: 'danger',
    checkout: 'warning', confirm: 'success' } as any)[k] || '';
}

async function load() {
  data.value = await api.get('/timeline', { params: { date: date.value, studentId: studentId.value } });
  if (!active.value.length) active.value = data.value.students.map((s: any) => s.reservationId);
}
onMounted(async () => {
  const meta = await api.get('/meta');
  students.value = meta.students;
  load();
});
</script>
<style scoped>.muted{color:#999;font-size:12px}</style>
