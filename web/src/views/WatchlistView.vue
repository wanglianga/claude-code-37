<template>
  <el-row :gutter="14">
    <el-col :span="13">
      <el-card>
        <div class="card-title">⭐ 重点关注学生名单</div>
        <el-alert type="warning" :closable="false" style="margin-bottom:10px"
          title="规则：学生因迟到、离座、临时外出、冲突、设备丢失、晚归、晚间无人接等事件累计异常分，达到 8 分自动进入名单；在名单中的学生后续预约需家长重新确认后才生效。" />
        <el-table :data="rows" size="small" empty-text="暂无重点关注学生">
          <el-table-column prop="name" label="姓名" width="100" />
          <el-table-column prop="grade" label="年级" width="70" />
          <el-table-column prop="abnormalScore" label="异常分" width="90">
            <template #default="{row}">
              <el-tag :type="row.abnormalScore>=10?'danger':'warning'">{{ row.abnormalScore }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="careNeeds" label="照护备注" min-width="160" />
          <el-table-column label="操作" width="150">
            <template #default="{row}">
              <el-button size="small" type="success" @click="remove(row)">移出名单并清零</el-button>
            </template>
          </el-table-column>
        </el-table>
      </el-card>
    </el-col>
    <el-col :span="11">
      <el-card>
        <div class="card-title">手动纳入关注（社区负责人/工作人员）</div>
        <el-select v-model="studentId" filterable placeholder="选择学生" style="width:100%;margin-bottom:10px">
          <el-option v-for="s in students.filter(x=>!x.watchlisted)" :key="s.id"
            :label="`${s.name}（${s.grade} 年级）`" :value="s.id" />
        </el-select>
        <el-button type="danger" :disabled="!studentId" @click="add">加入重点关注名单</el-button>
        <el-divider />
        <div class="muted">名单生效后，该学生在家长端提交的新预约会显示醒目标记，并进入「待家长重新确认」状态；家长重新确认前不占排班与座位容量。</div>
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';

const rows = ref<any[]>([]);
const students = ref<any[]>([]);
const studentId = ref<number | null>(null);

async function load() {
  rows.value = await api.get('/watchlist');
  const meta = await api.get('/meta');
  students.value = meta.students;
}
async function add() {
  await api.post(`/students/${studentId.value}/watchlist`, { watchlisted: true });
  ElMessage.success('已加入重点关注名单，后续预约需家长重新确认');
  studentId.value = null;
  load();
}
async function remove(row: any) {
  await ElMessageBox.confirm(`确定将 ${row.name} 移出名单并清零异常分？`, '提示', { type: 'warning' });
  await api.post(`/students/${row.id}/watchlist`, { watchlisted: false });
  ElMessage.success('已移出名单');
  load();
}
onMounted(load);
</script>
<style scoped>.muted{color:#909399;font-size:13px;line-height:1.7}</style>
