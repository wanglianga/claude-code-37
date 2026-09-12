<template>
  <el-row :gutter="14">
    <el-col :span="12">
      <el-card>
        <div class="card-title">🕒 社区开放时间（含低年级独自离场截止）</div>
        <el-table :data="meta.schedules" size="small" border>
          <el-table-column label="星期" width="80">
            <template #default="{row}">{{ WD[row.weekday] }}<el-tag v-if="!row.active" size="small" type="info" style="margin-left:4px">未开放</el-tag></template>
          </el-table-column>
          <el-table-column prop="openTime" label="开放" width="80" />
          <el-table-column prop="closeTime" label="闭馆" width="80" />
          <el-table-column prop="soloLeaveDeadline" label="低年级独自离场截止" />
        </el-table>
        <el-divider />
        <el-form inline label-width="64px">
          <el-form-item label="星期">
            <el-select v-model="sch.weekday" style="width:100px">
              <el-option v-for="(n,i) in WD" :key="i" :label="n" :value="i" />
            </el-select>
          </el-form-item>
          <el-form-item label="开放"><el-time-picker v-model="sch.openTime" value-format="HH:mm" format="HH:mm" /></el-form-item>
          <el-form-item label="闭馆"><el-time-picker v-model="sch.closeTime" value-format="HH:mm" format="HH:mm" /></el-form-item>
          <el-form-item label="独自截止"><el-time-picker v-model="sch.soloLeaveDeadline" value-format="HH:mm" format="HH:mm" /></el-form-item>
          <el-button type="primary" @click="addSch">新增/覆盖开放日</el-button>
        </el-form>
      </el-card>
    </el-col>
    <el-col :span="12">
      <el-card>
        <div class="card-title">🧑‍🤝‍🧑 志愿者排班</div>
        <el-table :data="meta.shifts" size="small" border>
          <el-table-column prop="date" label="日期" width="110" />
          <el-table-column label="时段" width="130">
            <template #default="{row}">{{ row.startTime }}-{{ row.endTime }}</template>
          </el-table-column>
          <el-table-column prop="volunteerName" label="志愿者" />
          <el-table-column prop="careCapacity" label="看护上限" width="90" />
        </el-table>
        <el-divider />
        <el-form inline label-width="64px">
          <el-form-item label="日期"><el-date-picker v-model="shift.date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
          <el-form-item label="起止">
            <el-time-picker v-model="shift.startTime" value-format="HH:mm" format="HH:mm" placeholder="开始" />
            <el-time-picker v-model="shift.endTime" value-format="HH:mm" format="HH:mm" placeholder="结束" style="margin-left:6px" />
          </el-form-item>
          <el-form-item label="志愿者">
            <el-select v-model="shift.volunteerId" style="width:140px">
              <el-option v-for="v in volunteers" :key="v.id" :label="v.name" :value="v.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="上限"><el-input-number v-model="shift.careCapacity" :min="1" :max="40" style="width:110px" /></el-form-item>
          <el-button type="primary" @click="addShift">增加排班</el-button>
        </el-form>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const meta = ref<any>({ schedules: [], shifts: [] });
const volunteers = ref<any[]>([]);
const sch = reactive<any>({ weekday: 6, openTime: '09:00', closeTime: '17:30', soloLeaveDeadline: '16:00' });
const shift = reactive<any>({ date: new Date().toLocaleDateString('en-CA'), startTime: '16:30', endTime: '21:00', volunteerId: null, careCapacity: 12 });

async function load() { meta.value = await api.get('/meta', { params: { date: shift.date } }); }
async function addSch() {
  if (!sch.openTime || !sch.closeTime) return ElMessage.warning('请选择开放时间');
  await api.post('/schedules', sch);
  ElMessage.success('开放时间已保存');
  load();
}
async function addShift() {
  if (!shift.volunteerId) return ElMessage.warning('请选择志愿者');
  await api.post('/shifts', shift);
  ElMessage.success('排班已增加');
  load();
}
onMounted(async () => {
  volunteers.value = await api.get('/volunteers');
  shift.volunteerId = volunteers.value[0]?.id;
  load();
});
</script>
