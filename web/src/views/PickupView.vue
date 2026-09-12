<template>
  <el-row :gutter="14">
    <el-col :span="8">
      <el-card>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="card-title" style="margin:0">🌙 晚间无人接处置（{{ date }}）</div>
          <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" size="small" @change="load" />
        </div>
        <el-radio-group v-model="filter" size="small" style="margin-bottom:8px">
          <el-radio-button value="active">处置中</el-radio-button>
          <el-radio-button value="resolved">已接走</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
        <el-scrollbar height="calc(100vh - 245px)">
          <div v-for="c in filtered" :key="c.id" class="case-item" :class="{active: current?.id===c.id}" @click="open(c.id)">
            <div class="case-head">
              <b>{{ c.studentName }}</b>
              <el-tag size="small" :type="statusType(c.status)">{{ STATUS_LABEL_CASE[c.status] }}</el-tag>
              <el-tag v-if="c.soloRestrictedAfter" size="small" type="danger" effect="dark">限独自</el-tag>
            </div>
            <div class="muted">
              {{ c.grade }} 年级 · 计划 {{ c.plannedLeave }} 离场 ·
              授权{{ c.authorizedLeaveMode === 'solo' ? '独自' : '家长接' }}
            </div>
            <div class="muted">
              联系 {{ c.contactAttempts }} 次（接通 {{ c.contactReached }}）
              <template v-if="c.gridWorkerName"> · 网格员 {{ c.gridWorkerName }}</template>
              <template v-if="c.pickupPersonName"> · 接走人 {{ c.pickupPersonName }}</template>
            </div>
          </div>
          <el-empty v-if="!filtered.length" description="当日暂无无人接处置单" />
        </el-scrollbar>
      </el-card>
    </el-col>

    <el-col :span="16">
      <el-card v-if="current">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <h3 style="margin:0">
              {{ current.student.name }}
              <el-tag size="small" type="danger" v-if="current.grade<=3">低年级</el-tag>
              <el-tag size="small">{{ STATUS_LABEL_CASE[current.status] }}</el-tag>
            </h3>
            <div class="muted">开单 {{ fmt(current.openedAt) }}
              <template v-if="current.resolvedAt"> · 结案 {{ fmt(current.resolvedAt) }}</template>
            </div>
          </div>
          <el-tag v-if="current.soloRestrictedAfter" type="danger" effect="dark">该家庭已被限制独自离场</el-tag>
        </div>

        <!-- 决策依据 -->
        <el-descriptions :column="3" border size="small" style="margin-top:12px">
          <el-descriptions-item label="授权离场方式">
            {{ current.authorizedLeaveMode === 'solo' ? '独自离场' : '家长接' }}
          </el-descriptions-item>
          <el-descriptions-item label="年级/年龄">{{ current.gradeSnapshot }} 年级</el-descriptions-item>
          <el-descriptions-item label="计划离场">{{ current.reservation.plannedLeave }}</el-descriptions-item>
          <el-descriptions-item label="到场时段">{{ current.reservation.arrivalSlot }}</el-descriptions-item>
          <el-descriptions-item label="紧急联系人">{{ current.reservation.emergencyContact || '—' }}</el-descriptions-item>
          <el-descriptions-item label="紧急电话">{{ current.reservation.emergencyPhone || '—' }}</el-descriptions-item>
        </el-descriptions>
        <el-alert :title="'处置建议：' + current.suggestion" type="warning" :closable="false" show-icon style="margin:10px 0" />

        <template v-if="current.status !== 'resolved'">
          <!-- 联系留痕 -->
          <el-card shadow="never" style="margin-bottom:10px">
            <div class="card-title">📞 联系家长（次数与回复留痕）</div>
            <el-space wrap>
              <el-button size="small" type="danger" plain @click="contact(false)">记录未接通</el-button>
              <el-button size="small" type="success" plain @click="contact(true)">记录已接通</el-button>
              <el-input v-model="replyDraft" size="small" type="textarea" :rows="1" style="width:380px"
                        placeholder="家长回复内容（工作人员代记，或家长端回复）" />
              <el-button size="small" type="primary" :disabled="!replyDraft.trim()" @click="parentReply">登记回复</el-button>
            </el-space>
            <div class="muted" style="margin-top:6px">
              已联系 {{ current.contactAttempts }} 次，接通 {{ current.contactReached }} 次
              <template v-if="current.lastParentReply">
                ｜ 最近回复：{{ current.lastParentReply }}（{{ fmt(current.lastParentReplyAt) }}）
              </template>
            </div>
          </el-card>

          <!-- 处置决策：值班人员 -->
          <el-card v-if="canOfficer" shadow="never" style="margin-bottom:10px">
            <div class="card-title">🧑‍💼 值班人员处置决策</div>
            <el-space wrap>
              <el-button size="small" @click="decide('wait')">继续留守等待</el-button>
              <el-button size="small" type="warning" @click="decide('escort')">志愿者陪同到门口</el-button>
              <el-button size="small" type="primary" @click="decide('temp_care')">转入临时看护</el-button>
              <el-button size="small" type="danger" @click="openEscalate">家长无响应·升级网格员</el-button>
            </el-space>
            <div class="muted" style="margin-top:6px">
              当前值守：{{ current.dutyStaffName || '—' }}
              <template v-if="current.escortName"> ｜ 陪同：{{ current.escortName }}</template>
              <template v-if="current.tempCareLocation"> ｜ 临时看护点：{{ current.tempCareLocation }}</template>
            </div>
          </el-card>
        </template>

        <!-- 接走结案 -->
        <el-card v-if="canResolve && current.status !== 'resolved'" shadow="never" style="margin-bottom:10px">
          <div class="card-title">✅ 登记接走人并锁定现场</div>
          <el-form :model="resolveForm" label-width="110px" size="small">
            <el-row :gutter="10">
              <el-col :span="12"><el-form-item label="接走人姓名"><el-input v-model="resolveForm.pickupPersonName" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="与学生关系"><el-input v-model="resolveForm.pickupPersonRelation" placeholder="如 姑姑/父亲同事" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="联系电话"><el-input v-model="resolveForm.pickupPersonPhone" /></el-form-item></el-col>
              <el-col :span="12"><el-form-item label="证件核验"><el-input v-model="resolveForm.pickupPersonIdCard" placeholder="证件类型/后四位" /></el-form-item></el-col>
            </el-row>
            <el-form-item label="家长确认">
              <el-switch v-model="resolveForm.parentConfirmed" active-text="已与家长电话/消息确认放行" />
            </el-form-item>
            <el-form-item label="限制后续独自离场">
              <el-switch v-model="resolveForm.restrictSolo"
                         active-text="限制该家庭后续预约独自离场（低龄/未联系上/已升级时默认限制）" />
            </el-form-item>
            <el-button type="success" @click="doResolve">接走结案并锁定快照</el-button>
          </el-form>
        </el-card>

        <el-alert v-if="current.status==='resolved'" type="success" :closable="false" show-icon style="margin-bottom:10px"
          :title="`已结案：${current.resolution}`"
          :description="`接走人 ${current.pickupPersonName}（${current.pickupPersonRelation}），家长确认：${current.parentConfirmedPickup ? '是' : '否'}`" />

        <!-- 处置流水 + 现场快照 -->
        <el-tabs>
          <el-tab-pane label="处置时间线">
            <el-timeline>
              <el-timeline-item v-for="a in current.actions" :key="a.id"
                :timestamp="fmt(a.time)" placement="top" :type="actionType(a.type)">
                <el-tag size="small" :type="actionType(a.type)">{{ ACTION_LABEL[a.type] }}</el-tag>
                <el-tag size="small" type="info" style="margin:0 6px">{{ ROLE_LABEL[a.actorRole] }} · {{ a.actorName }}</el-tag>
                <div style="margin-top:2px">{{ a.detail }}</div>
              </el-timeline-item>
            </el-timeline>
          </el-tab-pane>
          <el-tab-pane label="锁定的现场快照">
            <el-alert type="info" :closable="false" style="margin-bottom:8px"
              :title="`快照锁定于 ${fmt(current.lockedSnapshot?.lockedAt)}（迟到学生、临时接送人、当日巡查班次不可更改，家长追问可据此还原）`" />
            <template v-if="current.lockedSnapshot">
              <el-descriptions :column="2" border size="small">
                <el-descriptions-item label="预约">{{ current.lockedSnapshot.reservation?.arrivalSlot }} ~
                  {{ current.lockedSnapshot.reservation?.plannedLeave }}（{{ current.lockedSnapshot.reservation?.leaveMode==='solo'?'独自':'家长接' }}）</el-descriptions-item>
                <el-descriptions-item label="座位">{{ current.lockedSnapshot.reservation?.seat || '—' }}</el-descriptions-item>
                <el-descriptions-item label="紧急联系">{{ current.lockedSnapshot.reservation?.emergencyContact }}
                  {{ current.lockedSnapshot.reservation?.emergencyPhone }}</el-descriptions-item>
                <el-descriptions-item label="过敏/照护">{{ current.lockedSnapshot.reservation?.allergies || '无' }}
                  {{ current.lockedSnapshot.reservation?.careNote }}</el-descriptions-item>
              </el-descriptions>
              <div class="snap-title">迟到/临时外出</div>
              <el-tag v-for="(l,i) in current.lockedSnapshot.late" :key="i" type="danger" size="small" style="margin:2px">
                {{ l.detail }}（{{ l.by }}）
              </el-tag>
              <span v-if="!current.lockedSnapshot.late?.length" class="muted">无</span>
              <div class="snap-title">当日巡查班次</div>
              <el-table :data="current.lockedSnapshot.patrolShifts" size="small" border>
                <el-table-column prop="recorderName" label="值守/巡查人" width="120" />
                <el-table-column prop="count" label="巡查次数" width="90" />
                <el-table-column label="区域"><template #default="{row}">{{ row.areas.join('、') }}</template></el-table-column>
              </el-table>
              <div class="snap-title">志愿者排班</div>
              <el-table :data="current.lockedSnapshot.volunteerShifts" size="small" border>
                <el-table-column prop="volunteerName" label="志愿者" />
                <el-table-column label="班次"><template #default="{row}">{{ row.startTime }}-{{ row.endTime }}</template></el-table-column>
                <el-table-column prop="careCapacity" label="看护上限" width="90" />
              </el-table>
              <div v-if="current.lockedSnapshot.pickupPerson" class="snap-title">实际接走人（锁定）</div>
              <el-descriptions v-if="current.lockedSnapshot.pickupPerson" :column="2" border size="small">
                <el-descriptions-item label="姓名">{{ current.lockedSnapshot.pickupPerson.name }}</el-descriptions-item>
                <el-descriptions-item label="关系">{{ current.lockedSnapshot.pickupPerson.relation }}</el-descriptions-item>
                <el-descriptions-item label="电话">{{ current.lockedSnapshot.pickupPerson.phone || '—' }}</el-descriptions-item>
                <el-descriptions-item label="证件">{{ current.lockedSnapshot.pickupPerson.idCard || '—' }}</el-descriptions-item>
              </el-descriptions>
            </template>
          </el-tab-pane>
        </el-tabs>
      </el-card>
      <el-empty v-else description="选择左侧处置单查看决策依据与现场还原" />
    </el-col>
  </el-row>

  <el-dialog v-model="escDialog" title="升级网格员" width="440px">
    <el-form label-width="100px">
      <el-form-item label="网格员姓名"><el-input v-model="escForm.gridWorkerName" placeholder="接报网格员" /></el-form-item>
      <el-form-item label="说明"><el-input v-model="escForm.note" type="textarea" :rows="2" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="escDialog=false">取消</el-button>
      <el-button type="danger" @click="doEscalate">确认升级（家长持续无响应）</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import { ROLE_LABEL, useAuth } from '../store';

const auth = useAuth();
const date = ref(new Date().toLocaleDateString('en-CA'));
const list = ref<any[]>([]);
const current = ref<any>(null);
const filter = ref('active');
const replyDraft = ref('');
const escDialog = ref(false);
const escForm = reactive({ gridWorkerName: '', note: '' });
const resolveForm = reactive<any>({
  pickupPersonName: '', pickupPersonRelation: '', pickupPersonPhone: '',
  pickupPersonIdCard: '', parentConfirmed: false, restrictSolo: true,
});

const STATUS_LABEL_CASE: Record<string, string> = {
  waiting: '留守等待中', escorted: '已陪同到门口', temp_care: '临时看护中',
  escalated: '已升级网格员', resolved: '已接走锁定',
};
const ACTION_LABEL: Record<string, string> = {
  open: '开单', contact_attempt: '联系家长', parent_reply: '家长回复', wait: '继续留守',
  escort: '陪同到门口', temp_care: '临时看护', escalate: '升级网格员', resolve: '接走锁定',
};
const canOfficer = computed(() => ['staff', 'admin'].includes(auth.role));
const canResolve = computed(() => ['staff', 'admin', 'security'].includes(auth.role));
const filtered = computed(() => filter.value === 'all' ? list.value
  : filter.value === 'resolved' ? list.value.filter(c => c.status === 'resolved')
  : list.value.filter(c => c.status !== 'resolved'));

function statusType(s: string) {
  return ({ waiting: 'warning', escorted: 'primary', temp_care: 'primary', escalated: 'danger', resolved: 'success' } as any)[s];
}
function actionType(t: string) {
  return ({ open: 'info', contact_attempt: 'warning', parent_reply: 'success', wait: 'warning',
    escort: 'primary', temp_care: 'primary', escalate: 'danger', resolve: 'success' } as any)[t];
}
function fmt(t?: string) { return t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—'; }

async function load() {
  list.value = await api.get('/pickup-cases', { params: { date: date.value } });
  if (current.value) await open(current.value.id);
}
async function open(id: number) {
  current.value = await api.get(`/pickup-cases/${id}`);
  replyDraft.value = '';
  Object.assign(resolveForm, {
    pickupPersonName: current.value.pickupPersonName || '',
    pickupPersonRelation: '', pickupPersonPhone: current.value.pickupPersonPhone || '',
    pickupPersonIdCard: '', parentConfirmed: false,
    restrictSolo: current.value.gradeSnapshot <= 3 || current.value.status === 'escalated',
  });
}
async function contact(reached: boolean) {
  const { value } = await ElMessageBox.prompt(reached ? '接通情况备注' : '未接通备注（可留空）',
    reached ? '记录已接通' : '记录未接通', { inputValue: reached ? '家长表示尽快到' : '', confirmButtonText: '保存' })
    .catch(() => ({ value: null }));
  if (value === null) return;
  await api.post(`/pickup-cases/${current.value.id}/contact`, { reached, note: value || '', channel: '电话' });
  ElMessage.success('联系记录已留存');
  load();
}
async function parentReply() {
  await api.post(`/pickup-cases/${current.value.id}/parent-reply`, { content: replyDraft.value.trim() });
  replyDraft.value = '';
  ElMessage.success('家长回复已登记');
  load();
}
async function decide(decision: string) {
  const payload: any = {};
  if (decision === 'temp_care') {
    const { value } = await ElMessageBox.prompt('临时看护地点', '转入临时看护', { inputValue: '社区临时看护室' })
      .catch(() => ({ value: null }));
    if (value === null) return;
    payload.tempCareLocation = value;
  }
  if (decision === 'escort') payload.escortName = auth.user.name;
  await api.post(`/pickup-cases/${current.value.id}/decide`, { decision, ...payload });
  ElMessage.success('处置决策已记录');
  load();
}
function openEscalate() {
  Object.assign(escForm, { gridWorkerName: '', note: '' });
  escDialog.value = true;
}
async function doEscalate() {
  if (!escForm.gridWorkerName.trim()) return ElMessage.warning('请填写网格员姓名');
  await api.post(`/pickup-cases/${current.value.id}/escalate`, { ...escForm });
  escDialog.value = false;
  ElMessage.success('已升级网格员并联动协同事件');
  load();
}
async function doResolve() {
  if (!resolveForm.pickupPersonName || !resolveForm.pickupPersonRelation)
    return ElMessage.warning('请登记接走人姓名与关系');
  await ElMessageBox.confirm('接走后将锁定现场快照并办理离场，确定结案？', '确认', { type: 'warning' });
  await api.post(`/pickup-cases/${current.value.id}/resolve`, { ...resolveForm });
  ElMessage.success('已接走结案，处置已进入该家庭离场风险记录');
  load();
}
onMounted(load);
</script>

<style scoped>
.case-item { border:1px solid #ebeef5; border-radius:8px; padding:10px; margin-bottom:8px; cursor:pointer; }
.case-item.active { border-color:#409eff; box-shadow:0 0 0 2px rgba(64,158,255,.15); }
.case-head { display:flex; align-items:center; gap:6px; margin-bottom:4px; }
.muted { color:#999; font-size:12px; }
.snap-title { font-weight:600; margin:10px 0 6px; }
</style>
