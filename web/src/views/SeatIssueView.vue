<template>
  <el-row :gutter="14">
    <el-col :span="8">
      <el-card>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="card-title" style="margin:0">💺 座位冲突 / 物品遗失（{{ date }}）</div>
          <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" size="small" @change="load" />
        </div>
        <el-radio-group v-model="filter" size="small" style="margin-bottom:8px">
          <el-radio-button value="active">处置中</el-radio-button>
          <el-radio-button value="resolved">已结案</el-radio-button>
          <el-radio-button value="all">全部</el-radio-button>
        </el-radio-group>
        <el-scrollbar height="calc(100vh - 245px)">
          <div v-for="i in filtered" :key="i.id" class="issue-item" :class="{active: current?.id===i.id}" @click="open(i.id)">
            <div class="issue-head">
              <el-tag size="small" :type="i.type==='item_lost'?'warning':'danger'">
                {{ i.type==='item_lost' ? '物品遗失' : '座位冲突' }}
              </el-tag>
              <el-tag size="small" :type="i.status==='resolved'?'success':'warning'">
                {{ i.status==='resolved' ? '已结案' : '处置中' }}
              </el-tag>
              <el-tag v-if="i.involvesBlindSpot" size="small" type="info" effect="dark">监控盲区</el-tag>
            </div>
            <div class="issue-title">{{ i.title }}</div>
            <div class="muted">{{ i.studentName }} · {{ i.seatCode }}
              <template v-if="i.newSeatId"> → 已调座</template>
            </div>
            <div class="muted">{{ i.reportedByName }} 上报</div>
          </div>
          <el-empty v-if="!filtered.length" description="当日暂无座位事件" />
        </el-scrollbar>
      </el-card>
    </el-col>

    <el-col :span="16">
      <el-card v-if="current">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <h3 style="margin:0">
              {{ current.title }}
              <el-tag size="small" :type="current.type==='item_lost'?'warning':'danger'">
                {{ current.type==='item_lost' ? '物品遗失' : '座位冲突' }}
              </el-tag>
              <el-tag v-if="current.involvesBlindSpot" size="small" type="info" effect="dark">涉及监控盲区</el-tag>
            </h3>
            <div class="muted">{{ current.student.name }}（{{ current.student.grade }} 年级） · {{ current.reportedByName }} 上报 · {{ fmt(current.createdAt) }}</div>
          </div>
          <el-tag v-if="current.status==='resolved'" type="success" size="large">已结案</el-tag>
        </div>
        <p v-if="current.description" class="desc">{{ current.description }}</p>

        <!-- 自动关联的现场上下文 -->
        <div class="ctx-title">🔎 自动关联的现场证据</div>
        <el-descriptions :column="3" border size="small">
          <el-descriptions-item label="入场时间">{{ fmt(current.context.checkIn.at) }}（{{ current.context.checkIn.operator }}）</el-descriptions-item>
          <el-descriptions-item label="到场时段">{{ current.context.checkIn.arrivalSlot }}</el-descriptions-item>
          <el-descriptions-item label="入场核验">授权{{ current.context.checkIn.authVerified ? '✓' : '✗' }} 物品{{ current.context.checkIn.belongingsChecked ? '✓' : '✗' }}</el-descriptions-item>
          <el-descriptions-item label="座位分配">
            {{ current.context.seat.code }}（{{ ZONE_LABEL[current.context.seat.zone] }}）
            <el-tag size="small" :type="current.context.seat.monitored ? 'success' : 'danger'">
              {{ current.context.seat.monitored ? '监控覆盖' : '监控盲区' }}
            </el-tag>
            <span v-if="current.newSeat"> → {{ current.newSeat.code }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="场地">{{ current.context.seat.roomName }}</el-descriptions-item>
          <el-descriptions-item label="临时离场">{{ current.context.tempOuts.length }} 次</el-descriptions-item>
        </el-descriptions>

        <el-row :gutter="10" style="margin-top:8px">
          <el-col :span="12">
            <div class="ctx-title">同桌 / 邻座学生（{{ current.context.neighbors.length }}）</div>
            <el-table :data="current.context.neighbors" size="small" border empty-text="无邻座">
              <el-table-column prop="studentName" label="姓名" width="90" />
              <el-table-column prop="grade" label="年级" width="60" />
              <el-table-column prop="seatCode" label="座位" width="80" />
              <el-table-column label="入场"><template #default="{row}">{{ fmt(row.checkedInAt) }}</template></el-table-column>
            </el-table>
          </el-col>
          <el-col :span="12">
            <div class="ctx-title">相关巡查（{{ current.context.patrols.length }}）</div>
            <el-scrollbar height="150px">
              <el-timeline>
                <el-timeline-item v-for="(p,i) in current.context.patrols" :key="i" :timestamp="fmt(p.time)" placement="top" size="small">
                  {{ p.area }} {{ p.finding ? '— ' + p.finding : '（无异常）' }} <span class="muted">{{ p.by }}</span>
                </el-timeline-item>
              </el-timeline>
            </el-scrollbar>
          </el-col>
        </el-row>
        <div v-if="current.context.tempOuts.length" style="margin-top:6px">
          <div class="ctx-title">临时离场 / 离座记录</div>
          <el-tag v-for="(t,i) in current.context.tempOuts" :key="i" size="small" type="warning" style="margin:2px">
            {{ TEMP_LABEL[t.type] }} {{ fmt(t.at) }} {{ t.detail }}
          </el-tag>
        </div>

        <!-- 处置动作 -->
        <template v-if="current.status !== 'resolved'">
          <el-card shadow="never" style="margin-top:12px">
            <el-space wrap>
              <el-button type="primary" size="small" @click="openReassign">调整座位</el-button>
              <el-button v-if="current.type==='item_lost'" type="warning" size="small" @click="openSearch">发起寻物</el-button>
              <el-button size="small" @click="openContact">联系家长</el-button>
              <el-button type="success" size="small" @click="openResolve">结案（提频/盲区预算）</el-button>
            </el-space>
          </el-card>
        </template>

        <!-- 联动：当晚巡查重点 -->
        <el-card v-if="current.patrolFocuses.length" shadow="never" style="margin-top:10px">
          <div class="ctx-title">🚨 已联动当晚巡查重点</div>
          <el-table :data="current.patrolFocuses" size="small" border>
            <el-table-column prop="area" label="重点区域" min-width="180" />
            <el-table-column label="频次" width="120">
              <template #default="{row}">每 {{ row.frequencyMinutes }} 分钟</template>
            </el-table-column>
            <el-table-column prop="reason" label="原因" min-width="160" />
          </el-table>
        </el-card>

        <!-- 联动：维护预算 -->
        <el-card v-if="current.maintenanceItems.length" shadow="never" style="margin-top:10px">
          <div class="ctx-title">💰 监控盲区整改 · 场地维护预算</div>
          <el-table :data="current.maintenanceItems" size="small" border>
            <el-table-column prop="title" label="项目" min-width="200" />
            <el-table-column label="预算" width="100">
              <template #default="{row}">¥{{ row.estimatedCost }}</template>
            </el-table-column>
            <el-table-column label="状态" width="100">
              <template #default="{row}">
                <el-tag size="small" :type="row.status==='approved'?'success':row.status==='rejected'?'danger':'warning'">
                  {{ MAINT_STATUS[row.status] }}
                </el-tag>
              </template>
            </el-table-column>
          </el-table>
        </el-card>

        <el-divider />
        <el-timeline>
          <el-timeline-item v-for="a in current.actions" :key="a.id" :timestamp="fmt(a.time)" placement="top">
            <el-tag size="small">{{ ACTION_LABEL[a.type] }}</el-tag>
            <el-tag size="small" type="info" style="margin:0 6px">{{ ROLE_LABEL[a.actorRole] }} · {{ a.actorName }}</el-tag>
            <div style="margin-top:2px">{{ a.detail }}</div>
          </el-timeline-item>
        </el-timeline>
      </el-card>
      <el-empty v-else description="选择左侧座位事件查看现场证据与处置" />
    </el-col>
  </el-row>

  <!-- 调整座位 -->
  <el-dialog v-model="reassign.visible" title="调整座位" width="520px">
    <el-alert type="info" :closable="false" style="margin-bottom:10px"
      title="调座后将自动把陪读区、监控盲区、该生临时离场记录纳入当晚巡查重点。" />
    <el-select v-model="reassign.newSeatId" clearable filterable placeholder="不选则自动分配空闲且优先监控覆盖的座位" style="width:100%">
      <el-option v-for="s in freeSeats" :key="s.id"
        :label="`${s.code} ${ZONE_LABEL[s.zone]}${s.monitored?' · 监控覆盖':' · 监控盲区'} @${s.roomName}`" :value="s.id" />
    </el-select>
    <el-input v-model="reassign.note" style="margin-top:10px" placeholder="调座原因（可选）" />
    <template #footer>
      <el-button @click="reassign.visible=false">取消</el-button>
      <el-button type="primary" @click="doReassign">确认调座</el-button>
    </template>
  </el-dialog>

  <!-- 发起寻物 -->
  <el-dialog v-model="search.visible" title="发起寻物" width="460px">
    <el-form label-width="80px">
      <el-form-item label="物品名称"><el-input v-model="search.itemName" placeholder="如 白色电子词典 / 平板" /></el-form-item>
      <el-form-item label="备注"><el-input v-model="search.note" type="textarea" :rows="2" placeholder="特征、最后见到位置" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="search.visible=false">取消</el-button>
      <el-button type="warning" @click="doSearch">发起（查监控+问同桌+提频巡查）</el-button>
    </template>
  </el-dialog>

  <!-- 联系家长 -->
  <el-dialog v-model="contact.visible" title="联系家长" width="460px">
    <el-form label-width="80px">
      <el-form-item label="联系结果">
        <el-radio-group v-model="contact.reached"><el-radio :value="true">已接通</el-radio><el-radio :value="false">未接通</el-radio></el-radio-group>
      </el-form-item>
      <el-form-item label="情况"><el-input v-model="contact.note" type="textarea" :rows="3" /></el-form-item>
    </el-form>
    <template #footer>
      <el-button @click="contact.visible=false">取消</el-button>
      <el-button type="primary" @click="doContact">保存联系记录</el-button>
    </template>
  </el-dialog>

  <!-- 结案 -->
  <el-dialog v-model="resolveDlg.visible" title="结案" width="500px">
    <el-form label-width="120px">
      <el-form-item label="处置结果"><el-input v-model="resolveDlg.resolution" type="textarea" :rows="2" /></el-form-item>
      <el-form-item v-if="current?.type==='item_lost'" label="物品是否找回">
        <el-switch v-model="resolveDlg.itemFound" active-text="已找回" inactive-text="未找回" />
      </el-form-item>
      <el-form-item label="巡查提频（分钟）"><el-input-number v-model="resolveDlg.boostFrequency" :min="5" :max="60" :step="5" /></el-form-item>
      <el-alert type="warning" :closable="false" show-icon
        title="结案后该座位区巡查提频；若涉及监控盲区，将自动生成监控盲区整改的场地维护预算项（待管理员审批）。" />
    </el-form>
    <template #footer>
      <el-button @click="resolveDlg.visible=false">取消</el-button>
      <el-button type="success" @click="doResolve">确认结案</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';
import { ROLE_LABEL, ZONE_LABEL } from '../store';

const date = ref(new Date().toLocaleDateString('en-CA'));
const list = ref<any[]>([]);
const seats = ref<any[]>([]);
const current = ref<any>(null);
const filter = ref('active');

const ACTION_LABEL: Record<string, string> = {
  report: '上报', reassign: '调整座位', start_search: '发起寻物',
  contact_parent: '联系家长', parent_reply: '家长回复', note: '备注', resolve: '结案',
};
const TEMP_LABEL: Record<string, string> = { temp_out: '临时外出', returned: '外出返回', leave_seat: '离座' };
const MAINT_STATUS: Record<string, string> = { proposed: '待审批', approved: '已批准', rejected: '已驳回', done: '已完成' };

const filtered = computed(() => filter.value === 'all' ? list.value
  : filter.value === 'resolved' ? list.value.filter(i => i.status === 'resolved')
  : list.value.filter(i => i.status !== 'resolved'));
const freeSeats = computed(() => seats.value.filter(s => !s.reservation));
function fmt(t?: string) { return t ? new Date(t).toLocaleString('zh-CN', { hour12: false }) : '—'; }

async function load() {
  list.value = await api.get('/seat-issues', { params: { date: date.value } });
  const meta = await api.get('/meta', { params: { date: date.value } });
  seats.value = meta.seats;
  if (current.value) await open(current.value.id);
}
async function open(id: number) { current.value = await api.get(`/seat-issues/${id}`); }

const reassign = reactive<any>({ visible: false, newSeatId: null, note: '' });
function openReassign() {
  Object.assign(reassign, { visible: true, newSeatId: null, note: '' });
}
async function doReassign() {
  await api.post(`/seat-issues/${current.value.id}/reassign`, { newSeatId: reassign.newSeatId || undefined, note: reassign.note });
  ElMessage.success('座位已调整，相关区域已纳入当晚巡查重点');
  reassign.visible = false; load();
}
const search = reactive<any>({ visible: false, itemName: '', note: '' });
function openSearch() { Object.assign(search, { visible: true, itemName: '', note: '' }); }
async function doSearch() {
  await api.post(`/seat-issues/${current.value.id}/start-search`, { itemName: search.itemName, note: search.note });
  ElMessage.success('寻物已发起，座位区巡查提频至每 15 分钟');
  search.visible = false; load();
}
const contact = reactive<any>({ visible: false, reached: true, note: '' });
function openContact() { Object.assign(contact, { visible: true, reached: true, note: '' }); }
async function doContact() {
  await api.post(`/seat-issues/${current.value.id}/contact-parent`, { reached: contact.reached, note: contact.note });
  ElMessage.success('联系记录已保存');
  contact.visible = false; load();
}
const resolveDlg = reactive<any>({ visible: false, resolution: '', itemFound: true, boostFrequency: 20 });
function openResolve() {
  Object.assign(resolveDlg, { visible: true, resolution: '', itemFound: current.value.type === 'item_lost', boostFrequency: 20 });
}
async function doResolve() {
  await api.post(`/seat-issues/${current.value.id}/resolve`, {
    resolution: resolveDlg.resolution || undefined, itemFound: resolveDlg.itemFound, boostFrequency: resolveDlg.boostFrequency,
  });
  ElMessage.success('已结案，巡查提频生效；如涉及盲区已生成维护预算项');
  resolveDlg.visible = false; load();
}
onMounted(load);
</script>

<style scoped>
.issue-item { border:1px solid #ebeef5; border-radius:8px; padding:10px; margin-bottom:8px; cursor:pointer; }
.issue-item.active { border-color:#409eff; box-shadow:0 0 0 2px rgba(64,158,255,.15); }
.issue-head { display:flex; gap:6px; margin-bottom:5px; flex-wrap:wrap; }
.issue-title { font-weight:600; margin:3px 0; }
.muted { color:#999; font-size:12px; }
.desc { color:#555; margin:8px 0; }
.ctx-title { font-weight:600; margin:12px 0 6px; }
</style>
