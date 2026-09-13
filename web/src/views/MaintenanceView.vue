<template>
  <el-row :gutter="14">
    <el-col :span="15">
      <el-card>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="card-title" style="margin:0">💰 场地维护预算（监控盲区整改等）</div>
          <el-radio-group v-model="status" size="small" @change="load">
            <el-radio-button value="">全部</el-radio-button>
            <el-radio-button value="proposed">待审批</el-radio-button>
            <el-radio-button value="approved">已批准</el-radio-button>
            <el-radio-button value="rejected">已驳回</el-radio-button>
          </el-radio-group>
        </div>
        <el-table :data="items" size="small" border empty-text="暂无预算项">
          <el-table-column prop="title" label="项目" min-width="220" />
          <el-table-column prop="area" label="区域" width="110" />
          <el-table-column label="预算" width="100">
            <template #default="{row}">¥{{ row.estimatedCost }}</template>
          </el-table-column>
          <el-table-column prop="proposedByName" label="提出人" width="100" />
          <el-table-column label="状态" width="100">
            <template #default="{row}">
              <el-tag size="small" :type="row.status==='approved'?'success':row.status==='rejected'?'danger':'warning'">
                {{ STATUS[row.status] }}
              </el-tag>
            </template>
          </el-table-column>
          <el-table-column label="操作" width="170">
            <template #default="{row}">
              <template v-if="canApprove && row.status==='proposed'">
                <el-button size="small" type="success" @click="approve(row)">批准</el-button>
                <el-button size="small" type="danger" plain @click="reject(row)">驳回</el-button>
              </template>
              <span v-else class="muted">{{ row.approvedByName ? '审批：' + row.approvedByName : '—' }}</span>
            </template>
          </el-table-column>
        </el-table>
        <el-alert type="info" :closable="false" style="margin-top:10px"
          title="预算项由座位冲突/物品遗失事件结案时自动生成：事件涉及监控盲区即申请补装或调整摄像头；寻物结束后座位区巡查与监控盲区也会同步调整。" />
      </el-card>
    </el-col>
    <el-col :span="9">
      <el-card>
        <div class="card-title">预算汇总</div>
        <el-statistic title="待审批项" :value="counts.proposed" />
        <el-divider />
        <el-statistic title="待审批金额（元）" :value="amounts.proposed" />
        <el-divider />
        <el-statistic title="已批准金额（元）" :value="amounts.approved" />
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
import { useAuth } from '../store';

const auth = useAuth();
const items = ref<any[]>([]);
const status = ref('proposed');
const canApprove = computed(() => ['admin', 'staff'].includes(auth.role));
const STATUS: Record<string, string> = { proposed: '待审批', approved: '已批准', rejected: '已驳回', done: '已完成' };

const counts = computed(() => ({
  proposed: items.value.filter(i => i.status === 'proposed').length,
}));
const amounts = computed(() => ({
  proposed: items.value.filter(i => i.status === 'proposed').reduce((a, b) => a + Number(b.estimatedCost), 0),
  approved: items.value.filter(i => i.status === 'approved').reduce((a, b) => a + Number(b.estimatedCost), 0),
}));

async function load() {
  items.value = await api.get('/maintenance', { params: { status: status.value || undefined } });
}
async function approve(row: any) {
  const { value } = await ElMessageBox.prompt(`批准预算金额（当前 ¥${row.estimatedCost}）`, '批准预算', {
    inputValue: String(row.estimatedCost), inputPattern: /^\d+(\.\d{1,2})?$/, inputErrorMessage: '请输入金额',
  }).catch(() => ({ value: null }));
  if (value === null) return;
  await api.post(`/maintenance/${row.id}/approve`, { estimatedCost: Number(value) });
  ElMessage.success('已批准并纳入场地维护预算');
  load();
}
async function reject(row: any) {
  const { value } = await ElMessageBox.prompt('驳回原因', '驳回', { inputType: 'textarea' })
    .catch(() => ({ value: null }));
  if (value === null) return;
  await api.post(`/maintenance/${row.id}/reject`, { reason: value });
  ElMessage.success('已驳回');
  load();
}
onMounted(load);
</script>
<style scoped>.muted{color:#999;font-size:12px}</style>
