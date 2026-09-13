<template>
  <div>
    <el-row :gutter="16">
      <el-col :span="10">
        <el-card>
          <div class="card-title">📝 为孩子提交自习预约</div>
          <el-form :model="form" label-width="96px">
            <el-form-item label="学生">
              <el-select v-model="form.studentId" placeholder="选择学生" style="width:100%" @change="onStudent">
                <el-option v-for="s in meta.students" :key="s.id" :label="`${s.name}（${s.grade} 年级）`" :value="s.id" />
              </el-select>
            </el-form-item>
            <el-form-item label="日期">
              <el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD" style="width:100%"
                :disabled-date="d => isClosed(d)" />
            </el-form-item>
            <el-form-item label="到场时段">
              <el-select v-model="form.arrivalSlot" style="width:100%" placeholder="如 18:00-18:30">
                <el-option v-for="s in slots" :key="s" :label="s" :value="s" />
              </el-select>
            </el-form-item>
            <el-form-item label="计划离场">
              <el-time-picker v-model="form.plannedLeave" value-format="HH:mm" format="HH:mm" style="width:100%" />
            </el-form-item>
            <el-form-item label="离场方式">
              <el-radio-group v-model="form.leaveMode">
                <el-radio value="pickup">家长接</el-radio>
                <el-radio value="solo" :disabled="!!current?.soloPickupRestricted">独自离场</el-radio>
              </el-radio-group>
              <el-alert v-if="current?.soloPickupRestricted" type="error" :closable="false" style="margin-top:6px"
                title="该家庭存在晚间无人接处置记录，家庭全部孩子的独自离场均已被社区限制，本次须家长接；如需解除请联系社区工作人员。" />
            </el-form-item>
            <el-form-item label="紧急联系人">
              <el-input v-model="form.emergencyContact" placeholder="姓名/关系" />
            </el-form-item>
            <el-form-item label="紧急电话">
              <el-input v-model="form.emergencyPhone" />
            </el-form-item>
            <el-form-item label="过敏史">
              <el-input v-model="form.allergies" placeholder="如花生过敏，无则留空" />
            </el-form-item>
            <el-form-item label="特殊照护">
              <el-input v-model="form.careNote" type="textarea" :rows="2"
                placeholder="如：低龄请排低龄陪护区 / 希望安静区 / 临窗 / 用药提醒" />
            </el-form-item>
            <el-form-item label="给留言">
              <el-input v-model="form.parentNote" type="textarea" :rows="2" placeholder="给志愿者的留言（可选）" />
            </el-form-item>
            <el-alert v-if="current?.watchlisted" type="error" :closable="false" style="margin-bottom:12px"
              title="该学生在重点关注名单中：预约提交后需您再次确认才会生效。" />
            <el-button type="primary" :loading="saving" @click="submit">提交预约</el-button>
          </el-form>
        </el-card>
      </el-col>

      <el-col :span="14">
        <el-card>
          <div class="card-title">📋 我的预约（{{ meta.today }}）</div>
          <el-table :data="reservations" size="small" empty-text="当日暂无预约">
            <el-table-column label="学生" width="90">
              <template #default="{ row }">{{ row.student?.name }}</template>
            </el-table-column>
            <el-table-column prop="arrivalSlot" label="到场" width="100" />
            <el-table-column label="离场" width="110">
              <template #default="{ row }">
                {{ row.plannedLeave }} · {{ row.leaveMode === 'solo' ? '独自' : '家长接' }}
              </template>
            </el-table-column>
            <el-table-column label="座位" width="120">
              <template #default="{ row }">
                <span v-if="row.seat">{{ row.seat.code }}</span><span v-else>—</span>
              </template>
            </el-table-column>
            <el-table-column label="状态" width="120">
              <template #default="{ row }">
                <el-tag :type="STATUS_TYPE[row.status]" size="small">{{ STATUS_LABEL[row.status] }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="操作" min-width="230">
              <template #default="{ row }">
                <el-button v-if="row.status==='pending'" type="warning" size="small" @click="reconfirm(row)">
                  重新确认预约
                </el-button>
                <el-button v-if="['confirmed','pending'].includes(row.status)" size="small" @click="cancel(row)">取消</el-button>
                <el-button v-if="row.status==='checked_in'" size="small" @click="message(row)">留言</el-button>
                <el-button v-if="row.status==='checked_out' && !row.parentConfirmed" type="success" size="small"
                  @click="confirmOut(row)">确认安全接离</el-button>
                <el-tag v-if="row.parentConfirmed" type="success" size="small">已确认接离 ✓</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card style="margin-top:16px" v-if="pickupCases.length">
          <div class="card-title">🌙 晚间无人接处置（需要您尽快回复）</div>
          <el-table :data="pickupCases" size="small">
            <el-table-column label="学生" prop="studentName" width="90" />
            <el-table-column label="状态" width="120">
              <template #default="{row}"><el-tag size="small" type="warning">{{ CASE_LABEL[row.status] }}</el-tag></template>
            </el-table-column>
            <el-table-column label="联系情况" width="150">
              <template #default="{row}">工作人员已联系 {{ row.contactAttempts }} 次</template>
            </el-table-column>
            <el-table-column label="最近说明" prop="lastParentReply" min-width="120" />
            <el-table-column label="操作" width="180">
              <template #default="{row}">
                <el-button v-if="row.status!=='resolved'" type="primary" size="small" @click="replyPickup(row)">立即回复</el-button>
                <el-tag v-else type="success" size="small">已由 {{ row.pickupPersonName }} 接走</el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-card style="margin-top:16px" v-if="todayIncidents.length">
          <div class="card-title">⚠️ 与我的孩子相关的协同事件</div>
          <el-timeline>
            <el-timeline-item v-for="i in todayIncidents" :key="i.id" :timestamp="new Date(i.createdAt).toLocaleString('zh-CN')"
              :type="i.status==='resolved' ? 'success' : 'danger'">
              <el-link @click="$router.push('/incidents')">{{ i.title }}（{{ INCIDENT_LABEL[i.type] }}）—
                {{ i.status === 'resolved' ? '已关闭' : '处理中' }}</el-link>
            </el-timeline-item>
          </el-timeline>
        </el-card>
      </el-col>
    </el-row>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import { INCIDENT_LABEL, STATUS_LABEL, STATUS_TYPE } from '../store';

const meta = ref<any>({ students: [], schedules: [] });
const reservations = ref<any[]>([]);
const todayIncidents = ref<any[]>([]);
const pickupCases = ref<any[]>([]);
const CASE_LABEL: Record<string, string> = {
  waiting: '留守等待中', escorted: '陪同到门口', temp_care: '临时看护中',
  escalated: '已升级网格员', resolved: '已接走',
};
const saving = ref(false);
const form = reactive<any>({
  studentId: null, date: null, arrivalSlot: '', plannedLeave: '19:00',
  leaveMode: 'pickup', emergencyContact: '', emergencyPhone: '', allergies: '', careNote: '', parentNote: '',
});
const slots = ['16:30-17:00', '17:00-17:30', '17:30-18:00', '18:00-18:30', '18:30-19:00', '19:00-19:30', '19:30-20:00'];

const current = computed(() => meta.value.students.find((s: any) => s.id === form.studentId));

function isClosed(d: Date) {
  const wd = d.getDay();
  return !meta.value.schedules.some((s: any) => s.weekday === wd && s.active);
}
function onStudent(id: number) {
  const s = meta.value.students.find((x: any) => x.id === id);
  if (s) {
    form.emergencyContact = s.emergencyContact;
    form.emergencyPhone = s.emergencyPhone;
    form.allergies = s.allergies;
  }
}

async function load() {
  meta.value = await api.get('/meta');
  form.date = meta.value.today;
  if (meta.value.students[0]) { form.studentId = meta.value.students[0].id; onStudent(form.studentId); }
  await refreshReservations();
  const inc: any = await api.get('/incidents', { params: { date: meta.value.today } });
  const myKids = new Set(meta.value.students.map((s: any) => s.id));
  todayIncidents.value = inc.filter((i: any) => myKids.has(i.studentId));
  pickupCases.value = await api.get('/pickup-cases', { params: { date: meta.value.today } });
}
async function replyPickup(row: any) {
  const { value } = await ElMessageBox.prompt('请告知工作人员您的到达安排（谁来接、多久到）', '回复晚间无人接处置', {
    inputType: 'textarea', inputValue: '抱歉临时有事，孩子爸爸 15 分钟内到门口',
  }).catch(() => ({ value: null }));
  if (value === null) return;
  await api.post(`/pickup-cases/${row.id}/parent-reply`, { content: value });
  ElMessage.success('回复已送达值班人员并留痕');
  await load();
}
async function refreshReservations() {
  reservations.value = await api.get('/reservations', { params: { date: meta.value.today } });
}

async function submit() {
  if (!form.studentId || !form.arrivalSlot) return ElMessage.warning('请选择学生与到场时段');
  saving.value = true;
  try {
    await api.post('/reservations', { ...form, plannedLeave: form.plannedLeave || undefined });
    ElMessage.success(current.value?.watchlisted ? '已提交，请在列表中重新确认后生效' : '预约成功，已根据容量与排班生成');
    await refreshReservations();
  } finally { saving.value = false; }
}
async function reconfirm(row: any) {
  await api.post(`/reservations/${row.id}/reconfirm`);
  ElMessage.success('已重新确认，预约生效');
  refreshReservations();
}
async function cancel(row: any) {
  await ElMessageBox.confirm('确定取消该预约？', '提示', { type: 'warning' });
  await api.post(`/reservations/${row.id}/cancel`);
  refreshReservations();
}
async function message(row: any) {
  const { value } = await ElMessageBox.prompt('给在场志愿者留言', '家长留言', { inputType: 'textarea' });
  await api.post(`/reservations/${row.id}/message`, { content: value });
  ElMessage.success('留言已送达并记入自习记录');
}
async function confirmOut(row: any) {
  await api.post(`/reservations/${row.id}/parent-confirm`);
  ElMessage.success('已确认孩子安全接离/到家');
  refreshReservations();
}
onMounted(load);
</script>
