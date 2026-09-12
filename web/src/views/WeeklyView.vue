<template>
  <div v-if="report">
    <el-card>
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div class="card-title" style="margin:0">📊 周运营统计（{{ report.range[0] }} ~ {{ report.range[1] }}）</div>
        <el-date-picker v-model="endDate" type="date" value-format="YYYY-MM-DD" size="small" @change="load" />
      </div>
      <el-row :gutter="14" style="margin-top:16px">
        <el-col :span="5"><el-card shadow="never"><el-statistic title="周均座位使用率" :value="report.totals.avgUtilization" suffix="%" /></el-card></el-col>
        <el-col :span="5"><el-card shadow="never"><el-statistic title="周预约总数" :value="report.totals.reservations" /></el-card></el-col>
        <el-col :span="5"><el-card shadow="never"><el-statistic title="协同事件总数" :value="report.totals.incidents" /></el-card></el-col>
        <el-col :span="5"><el-card shadow="never"><el-statistic title="家长响应率" :value="report.totals.parentResponseRate" suffix="%" /></el-card></el-col>
        <el-col :span="4"><el-card shadow="never"><el-statistic title="巡查次数" :value="report.totals.patrols" /></el-card></el-col>
      </el-row>
    </el-card>

    <el-row :gutter="14" style="margin-top:14px">
      <el-col :span="14">
        <el-card>
          <div class="card-title">每日预约使用率与异常</div>
          <el-table :data="report.perDay" size="small" border>
            <el-table-column prop="date" label="日期" width="110" />
            <el-table-column label="使用率">
              <template #default="{row}">
                <el-progress :percentage="row.utilization" :status="row.utilization>=70?'success':''" :stroke-width="14" />
              </template>
            </el-table-column>
            <el-table-column prop="checkedIn" label="入场" width="60" />
            <el-table-column prop="noShow" label="未到" width="60" />
            <el-table-column prop="incidents" label="事件" width="60" />
            <el-table-column label="家长响应" width="90">
              <template #default="{row}">{{ row.parentResponseRate }}%</template>
            </el-table-column>
            <el-table-column label="低龄晚独自" width="90">
              <template #default="{row}">
                <el-tag size="small" :type="row.juniorSoloEvening?'danger':'info'">{{ row.juniorSoloEvening }}</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>
      <el-col :span="10">
        <el-card>
          <div class="card-title">异常事件分类</div>
          <div v-for="(n,key) in report.incidentByType" :key="key" class="bar-row">
            <span class="bar-label">{{ INCIDENT_LABEL[key] }}</span>
            <el-progress :percentage="pct(n)" :show-text="false" style="flex:1"
              :stroke-width="16" :color="barColor(key)" />
            <span class="bar-n">{{ n }}</span>
          </div>
          <el-empty v-if="!Object.keys(report.incidentByType).length" description="本周无异常事件" />
        </el-card>
      </el-col>
    </el-row>

    <el-card style="margin-top:14px">
      <div class="card-title">🧑‍💼 社区运营决策建议（周末开放 / 低龄陪护 / 晚间独自离场权限）</div>
      <el-alert v-for="(s,i) in report.suggestions" :key="i" :title="s" type="warning" :closable="false"
                show-icon style="margin-bottom:8px" />
      <el-alert title="决策依据：周均使用率≥70% 建议开放周末并增排班；出现冲突/晚间无人接建议增加低龄陪护；存在低年级晚间独自离场建议缩短独自离场截止时间；未到≥3 次建议加强家长提醒。"
                type="info" :closable="false" />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api } from '../api';
import { INCIDENT_LABEL } from '../store';

const report = ref<any>(null);
const endDate = ref(new Date().toLocaleDateString('en-CA'));
const totalInc = () => Math.max(1, ...Object.values(report.value?.incidentByType || {}) as number[]);
function pct(n: number) { return Math.round((n / totalInc()) * 100); }
function barColor(k: string) {
  return ({ night_unpicked: '#f56c6c', conflict: '#e6a23c', device_lost: '#409eff', no_show: '#909399',
    power_outage: '#f56c6c', pickup_change: '#67c23a', late_return: '#f56c6c' } as any)[k] || '#409eff';
}
async function load() {
  report.value = await api.get('/weekly-report', { params: { endDate: endDate.value } });
}
onMounted(load);
</script>
<style scoped>
.bar-row { display:flex; align-items:center; gap:10px; margin:10px 0; }
.bar-label { width:110px; font-size:13px; }
.bar-n { width:24px; text-align:right; font-weight:700; }
</style>
