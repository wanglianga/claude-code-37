<template>
  <el-row :gutter="14">
    <el-col :span="9">
      <el-card>
        <div class="card-title">🔦 新增安全巡查</div>
        <el-form label-width="82px">
          <el-form-item label="巡查区域">
            <el-select v-model="form.area" style="width:100%" allow-create filterable>
              <el-option v-for="a in areas" :key="a" :label="a" :value="a" />
            </el-select>
          </el-form-item>
          <el-form-item label="关联自习室">
            <el-select v-model="form.roomId" clearable style="width:100%">
              <el-option v-for="r in meta.rooms" :key="r.id" :label="r.name" :value="r.id" />
            </el-select>
          </el-form-item>
          <el-form-item label="是否正常">
            <el-switch v-model="form.normal" active-text="正常" inactive-text="发现异常" />
          </el-form-item>
          <el-form-item label="巡查发现">
            <el-input v-model="form.finding" type="textarea" :rows="3"
              :placeholder="form.normal ? '无异常可留空' : '描述异常（如通道堆物、监控黑屏、停电、学生冲突苗头）'" />
          </el-form-item>
          <el-button type="primary" @click="submit">提交巡查记录</el-button>
        </el-form>
      </el-card>
    </el-col>
    <el-col :span="15">
      <el-card>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div class="card-title" style="margin:0">巡查记录（{{ date }}）</div>
          <el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" size="small" @change="load" />
        </div>
        <el-timeline>
          <el-timeline-item v-for="p in rows" :key="p.id" :timestamp="new Date(p.time).toLocaleString('zh-CN')"
            :type="p.normal ? 'success' : 'danger'" placement="top">
            <b>{{ p.area }}</b>
            <el-tag size="small" :type="p.normal?'success':'danger'" style="margin-left:8px">
              {{ p.normal ? '正常' : '异常' }}
            </el-tag>
            <el-tag size="small" type="info" style="margin-left:6px">{{ p.roomName || '公共区域' }}</el-tag>
            <div v-if="p.finding" style="margin-top:4px">{{ p.finding }}</div>
            <div class="muted">记录人：{{ p.recorderName }}</div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-if="!rows.length" description="当日暂无巡查记录" />
      </el-card>
    </el-col>
  </el-row>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api } from '../api';

const areas = ['自习室全场', '出入口/监控死角', '低龄陪护区', '走廊与消防通道', '配电间/照明', '饮水间/卫生间'];
const meta = ref<any>({ rooms: [] });
const rows = ref<any[]>([]);
const date = ref(new Date().toLocaleDateString('en-CA'));
const form = reactive<any>({ area: '自习室全场', roomId: null, normal: true, finding: '' });

async function load() {
  rows.value = await api.get('/patrols', { params: { date: date.value } });
}
async function submit() {
  if (!form.area) return ElMessage.warning('请填写巡查区域');
  await api.post('/patrols', { ...form, roomId: form.roomId || undefined });
  ElMessage.success('巡查已记录，将进入当日档案与学生看护时间线');
  form.finding = '';
  load();
}
onMounted(async () => {
  meta.value = await api.get('/meta');
  form.roomId = meta.value.rooms[0]?.id;
  load();
});
</script>
<style scoped>.muted{color:#999;font-size:12px;margin-top:2px}</style>
