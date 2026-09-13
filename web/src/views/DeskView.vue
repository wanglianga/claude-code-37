<template>
  <div>
    <el-row :gutter="12" class="stat-row">
      <el-col :span="4" v-for="c in cards" :key="c.label">
        <el-card shadow="never" :body-style="{padding:'14px'}">
          <div class="stat-num" :style="{color:c.color}">{{ c.value }}</div>
          <div class="stat-label">{{ c.label }}</div>
        </el-card>
      </el-col>
      <el-col :span="4">
        <el-card shadow="never" :body-style="{padding:'14px'}">
          <div class="stat-num" style="color:#e6a23c">{{ openIncidents }}</div>
          <div class="stat-label">处理中事件</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div class="card-title" style="margin:0">🧑‍🏫 今日预约与入场/离场办理（{{ meta.today }}）</div>
        <div>
          <el-radio-group v-model="filter" size="small">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="confirmed">待到店</el-radio-button>
            <el-radio-button value="pending">待重新确认</el-radio-button>
            <el-radio-button value="checked_in">自习中</el-radio-button>
            <el-radio-button value="checked_out">已离场</el-radio-button>
            <el-radio-button value="no_show">未到</el-radio-button>
          </el-radio-group>
          <el-button size="small" style="margin-left:8px" @click="load">刷新</el-button>
        </div>
      </div>

      <el-table :data="filtered" size="small" row-key="id" :row-class-name="rowClass">
        <el-table-column label="学生" width="150">
          <template #default="{row}">
            <div><b>{{ row.student?.name }}</b>
              <el-tag v-if="row.student?.watchlisted" type="danger" size="small" effect="dark" style="margin-left:4px">关注</el-tag>
              <el-tag v-if="row.student?.soloPickupRestricted" type="danger" size="small" effect="plain" style="margin-left:4px">限独自离场</el-tag>
            </div>
            <div class="muted">{{ row.student?.grade }} 年级 · {{ row.student?.school }}</div>
          </template>
        </el-table-column>
        <el-table-column label="到场/离场" width="150">
          <template #default="{row}">
            <div>{{ row.arrivalSlot }}</div>
            <div class="muted">{{ row.plannedLeave }} · {{ row.leaveMode==='solo'?'独自离场':'家长接' }}</div>
          </template>
        </el-table-column>
        <el-table-column label="座位" width="150">
          <template #default="{row}">
            <div v-if="row.seat">{{ row.seat.code }}
              <el-tag size="small" v-if="!row.seat.monitored" type="warning">非监控</el-tag>
            </div>
            <div class="muted" v-if="row.seat">{{ ZONE_LABEL[row.seat.zone] }}</div>
            <span v-else class="muted">入场时分配</span>
          </template>
        </el-table-column>
        <el-table-column label="照护提示" min-width="170">
          <template #default="{row}">
            <el-tooltip v-if="row.allergies || row.student?.allergies || row.careNote" placement="top">
              <template #content>
                <div>过敏：{{ row.allergies || row.student?.allergies || '无' }}</div>
                <div>照护：{{ row.careNote || row.student?.careNeeds || '无' }}</div>
                <div>紧急联系：{{ row.student?.emergencyContact }} {{ row.student?.emergencyPhone }}</div>
              </template>
              <el-tag type="danger" size="small">过敏/照护</el-tag>
            </el-tooltip>
            <span v-else class="muted">无特殊</span>
            <div v-if="row.parentNote" class="note">💬 {{ row.parentNote }}</div>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="120">
          <template #default="{row}">
            <el-tag :type="STATUS_TYPE[row.status]" size="small">{{ STATUS_LABEL[row.status] }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{row}">
            <el-button v-if="['confirmed','no_show'].includes(row.status)" type="primary" size="small" @click="openCheckin(row)">
              入场核验
            </el-button>
            <el-button v-if="row.status==='checked_in'" size="small" @click="openRecord(row)">自习记录</el-button>
            <el-button v-if="row.status==='checked_in'" type="warning" size="small" @click="openCheckout(row)">离场</el-button>
            <el-button v-if="row.status==='checked_in' && isDue(row)" type="danger" plain size="small" @click="openPickup(row)">
              晚间无人接
            </el-button>
            <el-tooltip v-else-if="row.status==='checked_in'" content="学生尚未到计划离场时间，家长仍在正常接领窗口，到点后可开无人接处置" placement="top">
              <el-button type="danger" plain size="small" disabled>晚间无人接</el-button>
            </el-tooltip>
            <el-button size="small" @click="openIncident(row)">协同事件</el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <!-- 入场核验对话框 -->
    <el-dialog v-model="checkin.visible" title="入场核验" width="560px">
      <template v-if="checkin.row">
        <el-descriptions :column="2" border size="small">
          <el-descriptions-item label="学生">{{ checkin.row.student?.name }}（{{ checkin.row.student?.grade }}年级）</el-descriptions-item>
          <el-descriptions-item label="离场方式">{{ checkin.row.leaveMode==='solo'?'独自离场':'家长接' }}</el-descriptions-item>
          <el-descriptions-item label="过敏史">{{ checkin.row.allergies || checkin.row.student?.allergies || '无' }}</el-descriptions-item>
          <el-descriptions-item label="紧急联系">{{ checkin.row.student?.emergencyContact }} {{ checkin.row.student?.emergencyPhone }}</el-descriptions-item>
        </el-descriptions>
        <el-checkbox v-model="checkin.authVerified" style="margin-top:14px">✅ 已核验家长授权（预约信息/授权说明一致）</el-checkbox><br/>
        <el-checkbox v-model="checkin.belongingsChecked">🎒 已核验随身物品（电子设备登记、禁带物品）</el-checkbox><br/>
        <el-checkbox v-model="checkin.leaveModeVerified">🚪 已与学生/家长确认离场方式</el-checkbox>
        <el-form-item label="手动指定座位（可选，不选则自动分配）" style="margin-top:12px">
          <el-select v-model="checkin.seatId" clearable placeholder="自动：低龄→低龄区/安静→安静区/优先临窗+监控" style="width:100%">
            <el-option v-for="s in freeSeats" :key="s.id"
              :label="`${s.code} ${ZONE_LABEL[s.zone]}${s.monitored?' · 监控覆盖':' · 无监控'} @${s.roomName}`" :value="s.id" />
          </el-select>
        </el-form-item>
      </template>
      <template #footer>
        <el-button @click="checkin.visible=false">取消</el-button>
        <el-button type="primary" @click="doCheckin">确认入场并分配座位</el-button>
      </template>
    </el-dialog>

    <!-- 自习记录对话框 -->
    <el-dialog v-model="record.visible" title="自习过程记录" width="620px">
      <template v-if="record.row">
        <el-space wrap>
          <el-button v-for="t in eventTypes" :key="t.value" :type="t.type" size="small" plain
            @click="quickEvent(t.value, t.label)">{{ t.label }}</el-button>
        </el-space>
        <el-input v-model="record.detail" type="textarea" :rows="2" placeholder="记录详情（如：借 Type-C 充电器 / 19:20 返回）" style="margin:10px 0"/>
        <el-button type="primary" size="small" @click="addEvent">保存记录</el-button>
        <el-divider style="margin:12px 0" />
        <el-timeline>
          <el-timeline-item v-for="e in record.events" :key="e.id"
            :timestamp="new Date(e.occurredAt).toLocaleString('zh-CN')" placement="top">
            <el-tag size="small" :type="abnormalTypes.includes(e.type)?'danger':'info'">{{ eventLabel[e.type] }}</el-tag>
            {{ e.detail }}
            <span class="muted">— {{ e.recorderName }}</span>
          </el-timeline-item>
        </el-timeline>
      </template>
    </el-dialog>

    <!-- 离场对话框 -->
    <el-dialog v-model="checkout.visible" title="离场登记" width="480px">
      <template v-if="checkout.row">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="预约方式">{{ checkout.row.leaveMode==='solo'?'独自离场':'家长接' }}</el-descriptions-item>
          <el-descriptions-item label="座位">{{ checkout.row.seat?.code }}</el-descriptions-item>
        </el-descriptions>
        <el-radio-group v-model="checkout.mode" style="margin:14px 0">
          <el-radio value="solo">独自离场</el-radio>
          <el-radio value="pickup">家长接（请核对接送人）</el-radio>
        </el-radio-group>
        <el-alert v-if="checkout.row.student?.grade<=3 && checkout.mode==='solo'" type="warning" :closable="false"
          title="低年级学生独自离场：若已超过社区规定截止时间，系统将记录异常并建议发起协同事件。" />
      </template>
      <template #footer>
        <el-button @click="checkout.visible=false">取消</el-button>
        <el-button type="warning" @click="doCheckout">确认离场</el-button>
      </template>
    </el-dialog>

    <!-- 发起协同事件 -->
    <el-dialog v-model="inc.visible" title="发起跨角色协同事件" width="520px">
      <el-form label-width="92px">
        <el-form-item label="事件类型">
          <el-select v-model="inc.type" style="width:100%">
            <el-option v-for="(label,key) in INCIDENT_LABEL" :key="key" :label="label" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item label="标题"><el-input v-model="inc.title" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="inc.description" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="inc.visible=false">取消</el-button>
        <el-button type="danger" @click="doOpenIncident">发起（志愿者/社区/家长/安保协同）</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import { INCIDENT_LABEL, STATUS_LABEL, STATUS_TYPE, ZONE_LABEL } from '../store';

const meta = ref<any>({ seats: [], shifts: [] });
const rows = ref<any[]>([]);
const incidents = ref<any[]>([]);
const filter = ref('');

const filtered = computed(() => filter.value ? rows.value.filter(r => r.status === filter.value) : rows.value);
const freeSeats = computed(() => meta.value.seats.filter((s: any) => !s.reservation));
const openIncidents = computed(() => incidents.value.filter(i => i.status !== 'resolved').length);

const cards = computed(() => {
  const c = (s: string) => rows.value.filter(r => r.status === s).length;
  return [
    { label: '总预约', value: rows.value.length, color: '#303133' },
    { label: '待到店', value: c('confirmed') + c('pending'), color: '#409eff' },
    { label: '自习中', value: c('checked_in'), color: '#67c23a' },
    { label: '已离场', value: c('checked_out'), color: '#909399' },
    { label: '未到', value: c('no_show'), color: '#f56c6c' },
  ];
});

function rowClass({ row }: any) {
  if (row.student?.watchlisted) return 'watch-row';
  if (row.status === 'pending') return 'pending-row';
  return '';
}

/** 是否已到该预约的计划离场时间（上海墙上时间） */
function isDue(row: any) {
  if (!row.plannedLeave) return false;
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(11, 16); // UTC+8 HH:mm
  return now >= row.plannedLeave;
}

async function load() {
  meta.value = await api.get('/meta');
  rows.value = await api.get('/reservations', { params: { date: meta.value.today } });
  incidents.value = await api.get('/incidents', { params: { date: meta.value.today } });
}
onMounted(load);

// ---------- 入场 ----------
const checkin = reactive<any>({ visible: false, row: null, authVerified: false, belongingsChecked: false, leaveModeVerified: false, seatId: null });
function openCheckin(row: any) {
  Object.assign(checkin, { visible: true, row, authVerified: false, belongingsChecked: false, leaveModeVerified: false, seatId: null });
}
async function doCheckin() {
  if (!checkin.authVerified || !checkin.belongingsChecked || !checkin.leaveModeVerified) {
    return ElMessage.warning('三项核验必须全部勾选');
  }
  const r: any = await api.post(`/reservations/${checkin.row.id}/check-in`, {
    authVerified: true, belongingsChecked: true, leaveModeVerified: true, seatId: checkin.seatId || undefined,
  });
  ElMessage.success(`入场成功，座位 ${r.seat?.code}（${ZONE_LABEL[r.seat?.zone]}${r.seat?.monitored ? '·监控覆盖' : ''}）`);
  checkin.visible = false;
  load();
}

// ---------- 自习记录 ----------
const eventTypes = [
  { value: 'late', label: '迟到', type: 'danger' },
  { value: 'leave_seat', label: '离座', type: 'info' },
  { value: 'charger', label: '借用充电器', type: 'warning' },
  { value: 'temp_out', label: '临时外出', type: 'warning' },
  { value: 'returned', label: '外出返回', type: 'success' },
  { value: 'unwell', label: '身体不适', type: 'danger' },
  { value: 'parent_message', label: '家长留言', type: 'primary' },
];
const eventLabel: Record<string, string> = Object.fromEntries(eventTypes.map(t => [t.value, t.label]));
const abnormalTypes = ['late', 'temp_out', 'leave_seat', 'unwell'];
const record = reactive<any>({ visible: false, row: null, events: [], detail: '', type: 'charger' });

async function openRecord(row: any) {
  const detail: any = await api.get(`/reservations/${row.id}`);
  record.row = detail; record.events = detail.events; record.detail = '';
  record.visible = true;
}
async function quickEvent(type: string, label: string) {
  record.type = type;
  const { value } = await ElMessageBox.prompt(`${label} — 详情（可留空）`, label, {
    inputValue: record.detail, confirmButtonText: '保存',
  }).catch(() => ({ value: null }));
  if (value === null) return;
  await api.post(`/reservations/${record.row.id}/events`, { type, detail: value || '' });
  ElMessage.success('已记录');
  await openRecord(record.row);
  load();
}
async function addEvent() {
  if (!record.detail) return ElMessage.warning('请填写详情或使用快捷按钮');
  await api.post(`/reservations/${record.row.id}/events`, { type: 'parent_message', detail: record.detail });
  record.detail = '';
  await openRecord(record.row);
}

// ---------- 离场 ----------
const checkout = reactive<any>({ visible: false, row: null, mode: 'pickup' });
function openCheckout(row: any) {
  checkout.visible = true; checkout.row = row; checkout.mode = row.leaveMode;
}
async function doCheckout() {
  const r: any = await api.post(`/reservations/${checkout.row.id}/check-out`, { actualLeaveMode: checkout.mode });
  checkout.visible = false;
  if (r.warning) {
    ElMessageBox.alert(r.warning, '异常已记录', { type: 'warning' });
  } else {
    ElMessage.success('离场登记完成，等待家长电子确认');
  }
  load();
}

// ---------- 协同事件 ----------
const inc = reactive<any>({ visible: false, row: null, type: 'conflict', title: '', description: '' });
function openIncident(row: any) {
  Object.assign(inc, { visible: true, row, type: 'conflict', title: '', description: '' });
}
async function doOpenIncident() {
  if (!inc.title) return ElMessage.warning('请填写标题');
  await api.post('/incidents', {
    type: inc.type, title: inc.title, description: inc.description,
    reservationId: inc.row?.id, studentId: inc.row?.student?.id,
  });
  ElMessage.success('事件已发起，可在「协同事件」页联动处置');
  inc.visible = false;
  load();
}

// ---------- 晚间无人接处置 ----------
async function openPickup(row: any) {
  await ElMessageBox.confirm(
    `确认为「${row.student.name}」开启晚间无人接处置单？将锁定现场快照（迟到/当日巡查班次/预约），可继续联系家长、留守、临时看护或升级网格员。`,
    '晚间无人接开单', { type: 'warning', confirmButtonText: '开单并前往处置' });
  const c: any = await api.post('/pickup-cases', { reservationId: row.id });
  ElMessage.success(`处置单 #${c.id} 已开单，现场快照已锁定`);
  location.hash = '#/pickup';
}

</script>

<style scoped>
.stat-row .stat-num { font-size:26px; font-weight:700; }
.stat-label { color:#909399; font-size:13px; margin-top:2px; }
.muted { color:#909399; font-size:12px; }
.note { color:#e6a23c; font-size:12px; margin-top:2px; }
:deep(.watch-row) { background:#fef0f0 !important; }
:deep(.pending-row) { background:#fdf6ec !important; }
</style>
