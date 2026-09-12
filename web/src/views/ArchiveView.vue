<template>
  <div>
    <el-card>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="card-title" style="margin:0">📁 当日看护档案（{{ data.date || date }}）</div>
        <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" size="small" @change="load" />
      </div>
      <el-row :gutter="12" style="margin-top:14px">
        <el-col :span="3" v-for="c in cards" :key="c.label">
          <el-statistic :title="c.label" :value="c.value" />
        </el-col>
      </el-row>
    </el-card>

    <el-card style="margin-top:14px">
      <el-tabs v-model="tab">
        <el-tab-pane label="签到/座位/离场/家长确认" name="records">
          <el-table :data="data.records" size="small" border>
            <el-table-column prop="studentName" label="学生" width="90" />
            <el-table-column prop="grade" label="年级" width="60" />
            <el-table-column prop="arrivalSlot" label="到场时段" width="100" />
            <el-table-column label="状态" width="100">
              <template #default="{row}">
                <el-tag :type="STATUS_TYPE[row.status]" size="small">{{ STATUS_LABEL[row.status] }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="seat" label="座位（分区/监控）" min-width="200" />
            <el-table-column label="入场/离场经办人" width="170">
              <template #default="{row}">
                <div class="muted">入：{{ row.checkInOperator || '—' }}</div>
                <div class="muted">离：{{ row.checkOutOperator || '—' }}</div>
              </template>
            </el-table-column>
            <el-table-column label="实际离场/家长确认" width="190">
              <template #default="{row}">
                <div>{{ row.actualLeaveMode === 'solo' ? '独自离场' : row.actualLeaveMode === 'pickup' ? '家长接' : '—' }}</div>
                <el-tag v-if="row.parentConfirmed" type="success" size="small">家长已确认 ✓</el-tag>
                <el-tag v-else type="info" size="small">待家长确认</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="时间" width="170">
              <template #default="{row}">
                <div class="muted">入：{{ fmt(row.checkedInAt) }}</div>
                <div class="muted">离：{{ fmt(row.checkedOutAt) }}</div>
              </template>
            </el-table-column>
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`异常协同事件（${data.incidents?.length||0}）`" name="incidents">
          <el-table :data="data.incidents" size="small">
            <el-table-column label="类型" width="130">
              <template #default="{row}">
                <el-tag size="small">{{ INCIDENT_LABEL[row.type] }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="title" label="标题" min-width="220" />
            <el-table-column label="状态" width="100">
              <template #default="{row}">
                <el-tag size="small" :type="row.status==='resolved'?'success':'danger'">
                  {{ row.status==='resolved'?'已关闭':'处理中' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column prop="openedByName" label="发起人" width="100" />
            <el-table-column prop="resolution" label="处置结果" min-width="200" />
          </el-table>
        </el-tab-pane>
        <el-tab-pane :label="`巡查记录（${data.patrols?.length||0}）`" name="patrols">
          <el-timeline>
            <el-timeline-item v-for="p in data.patrols" :key="p.id"
              :timestamp="new Date(p.time).toLocaleString('zh-CN')" :type="p.normal?'success':'danger'">
              <b>{{ p.area }}</b> — {{ p.finding || '无异常' }}
              <span class="muted">（{{ p.recorderName }}）</span>
            </el-timeline-item>
          </el-timeline>
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import { INCIDENT_LABEL, STATUS_LABEL, STATUS_TYPE } from '../store';

const date = ref(new Date().toLocaleDateString('en-CA'));
const data = ref<any>({});
const tab = ref('records');
const cards = computed(() => {
  const s = data.value.summary || {};
  return [
    { label: '总预约', value: s.total ?? 0 },
    { label: '已入场', value: s.checkedIn ?? 0 },
    { label: '已离场', value: s.checkedOut ?? 0 },
    { label: '未到', value: s.noShow ?? 0 },
    { label: '待重新确认', value: s.pending ?? 0 },
    { label: '家长已确认', value: s.parentConfirmed ?? 0 },
    { label: '处理中事件', value: s.incidentsOpen ?? 0 },
    { label: '巡查次数', value: s.patrols ?? 0 },
  ];
});
function fmt(t: string) { return t ? new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—'; }
async function load() { data.value = await api.get('/daily-archive', { params: { date: date.value } }); }
onMounted(load);
</script>
<style scoped>.muted{color:#999;font-size:12px}</style>
