<template>
  <el-row :gutter="14">
    <el-col :span="9">
      <el-card>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="card-title" style="margin:0">🚨 协同事件（{{ date }}）</div>
          <div>
            <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" size="small" @change="load" />
            <el-select v-model="statusFilter" size="small" style="width:110px;margin-left:6px" @change="load" clearable
                       placeholder="全部状态">
              <el-option label="待响应" value="open" /><el-option label="处置中" value="responding" />
              <el-option label="已关闭" value="resolved" />
            </el-select>
          </div>
        </div>
        <el-input v-model="keyword" size="small" placeholder="搜索标题/学生" clearable style="margin-bottom:8px" />
        <el-scrollbar height="calc(100vh - 230px)">
          <div v-for="i in filtered" :key="i.id" class="inc-item" :class="{active: current?.id===i.id}" @click="open(i.id)">
            <div class="inc-head">
              <el-tag size="small" :type="typeColor(i.type)">{{ INCIDENT_LABEL[i.type] }}</el-tag>
              <el-tag size="small" :type="i.status==='resolved'?'success':(i.status==='open'?'danger':'warning')">
                {{ i.status==='open'?'待响应':i.status==='responding'?'处置中':'已关闭' }}
              </el-tag>
              <el-tag v-if="i.escalated" size="small" type="danger" effect="dark">已升级</el-tag>
            </div>
            <div class="inc-title">{{ i.title }}</div>
            <div class="muted">{{ i.openedByName }} 发起 · {{ new Date(i.createdAt).toLocaleString('zh-CN') }} · {{ i.messageCount }} 条进展</div>
          </div>
          <el-empty v-if="!filtered.length" description="暂无事件" />
        </el-scrollbar>
      </el-card>
    </el-col>

    <el-col :span="15">
      <el-card v-if="current">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <h3 style="margin:0">{{ current.title }}</h3>
            <div class="muted" style="margin:4px 0">
              {{ INCIDENT_LABEL[current.type] }} · 当事学生：{{ current.student?.name || '—' }} ·
              {{ current.openedByName }} 发起于 {{ new Date(current.createdAt).toLocaleString('zh-CN') }}
            </div>
          </div>
          <div>
            <el-button v-if="current.status!=='resolved'" type="danger" plain size="small" @click="escalate">升级联动</el-button>
            <el-button v-if="current.status!=='resolved'" type="success" size="small" @click="resolve">关闭事件</el-button>
          </div>
        </div>
        <el-alert v-if="current.description" :title="current.description" type="info" :closable="false" style="margin:10px 0" />
        <el-alert v-if="current.resolution" :title="'处置结果：' + current.resolution" type="success" :closable="false" style="margin:10px 0" />

        <div class="msg-board">
          <div v-for="m in current.messages" :key="m.id" class="msg" :class="'role-' + m.authorRole">
            <el-tag size="small" :type="roleColor(m.authorRole)">{{ ROLE_LABEL[m.authorRole] }} · {{ m.authorName }}</el-tag>
            <div class="msg-content">{{ m.content }}</div>
            <div class="muted">{{ new Date(m.createdAt).toLocaleString('zh-CN') }}</div>
          </div>
        </div>

        <div v-if="current.status!=='resolved'" style="margin-top:12px">
          <el-input v-model="draft" type="textarea" :rows="2"
            :placeholder="`以「${ROLE_LABEL[auth.role]} · ${auth.user.name}」身份补充处置进展（家长反馈/志愿者处理/安保监控/社区协调）`" />
          <el-button type="primary" style="margin-top:8px" @click="send">发送到协同事件</el-button>
        </div>
      </el-card>
      <el-empty v-else description="选择左侧事件查看协同处置时间线" />
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import { INCIDENT_LABEL, ROLE_LABEL, useAuth } from '../store';

const auth = useAuth();
const date = ref(new Date().toLocaleDateString('en-CA'));
const list = ref<any[]>([]);
const current = ref<any>(null);
const statusFilter = ref('');
const keyword = ref('');
const draft = ref('');

const filtered = computed(() => list.value.filter(i =>
  !keyword.value || i.title.includes(keyword.value) || (i.studentName || '').includes(keyword.value)));

function typeColor(t: string) {
  return ({ no_show: 'info', pickup_change: 'primary', night_unpicked: 'danger', conflict: 'warning',
    device_lost: 'warning', power_outage: 'danger', late_return: 'danger' } as any)[t] || 'info';
}
function roleColor(r: string) {
  return ({ parent: 'info', volunteer: 'success', staff: 'warning', security: 'primary', admin: 'danger' } as any)[r];
}

async function load() {
  list.value = await api.get('/incidents', { params: { date: date.value, status: statusFilter.value || undefined } });
  if (current.value) await open(current.value.id);
}
async function open(id: number) {
  current.value = await api.get(`/incidents/${id}`);
}
async function send() {
  if (!draft.value.trim()) return;
  await api.post(`/incidents/${current.value.id}/messages`, { content: draft.value.trim() });
  draft.value = '';
  await open(current.value.id);
  load();
}
async function escalate() {
  const { value } = await ElMessageBox.prompt('升级说明（通知社区负责人与安保联动）', '升级事件',
    { inputType: 'textarea' }).catch(() => ({ value: null }));
  if (value === null) return;
  await api.post(`/incidents/${current.value.id}/escalate`, { note: value });
  ElMessage.success('已升级联动');
  await open(current.value.id); load();
}
async function resolve() {
  const { value } = await ElMessageBox.prompt('处置结果', '关闭事件', {
    inputType: 'textarea', inputValue: current.value.resolution || '现场处置完毕',
  }).catch(() => ({ value: null }));
  if (value === null) return;
  await api.post(`/incidents/${current.value.id}/resolve`, { resolution: value });
  ElMessage.success('事件已关闭并归档');
  await open(current.value.id); load();
}
onMounted(load);
</script>

<style scoped>
.inc-item { border:1px solid #ebeef5; border-radius:8px; padding:10px; margin-bottom:8px; cursor:pointer; }
.inc-item.active { border-color:#409eff; box-shadow:0 0 0 2px rgba(64,158,255,.15); }
.inc-head { display:flex; gap:6px; margin-bottom:6px; flex-wrap:wrap; }
.inc-title { font-weight:600; margin:4px 0; }
.muted { color:#999; font-size:12px; }
.msg-board { max-height:46vh; overflow-y:auto; margin-top:10px; }
.msg { border-left:3px solid #ddd; padding:8px 10px; margin-bottom:8px; background:#fafbfc; border-radius:0 6px 6px 0; }
.role-parent { border-color:#909399; }
.role-volunteer { border-color:#67c23a; }
.role-staff { border-color:#e6a23c; }
.role-security { border-color:#409eff; }
.role-admin { border-color:#f56c6c; }
.msg-content { margin:5px 0; white-space:pre-wrap; }
</style>
