<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { NButton, NCard, NDataTable, NEmpty, NInput, NModal, NSpace, NSpin, useMessage } from 'naive-ui'
import { fetchDevices } from '@/api'
import { SvgIcon } from '@/components/common'

interface Device {
  [key: string]: any
  _source?: string
  name?: string
  status?: string
  type?: string
}

const devices = ref<Device[]>([])
const loading = ref(false)
const showModal = ref(false)
const editingDevice = ref<Device | null>(null)
const editForm = ref<Record<string, any>>({})
const ms = useMessage()

const columns = [
  { title: '名称', key: 'name', default: '-' },
  { title: '类型', key: 'type', default: '-' },
  { title: '状态', key: 'status', default: '-' },
  { title: '来源', key: '_source', default: '-' },
  { title: '操作', key: 'actions', width: 100 },
]

async function loadDevices() {
  loading.value = true
  try {
    const res = await fetchDevices<{ devices: Device[] }>()
    devices.value = res.data?.devices || []
  } catch (error) {
    ms.error('加载设备失败')
  } finally {
    loading.value = false
  }
}

function closeModal() {
  showModal.value = false
  editingDevice.value = null
  editForm.value = {}
}

async function saveDevice() {
  ms.success('保存成功')
  closeModal()
}

onMounted(loadDevices)
</script>

<template>
  <div class="h-full overflow-hidden flex flex-col">
    <header class="p-4 border-b dark:border-gray-700">
      <div class="flex items-center justify-between">
        <h1 class="text-xl font-bold">设备管理</h1>
        <NButton @click="loadDevices">
          <template #icon>
            <SvgIcon icon="ri:refresh-line" />
          </template>
          刷新
        </NButton>
      </div>
    </header>
    <main class="flex-1 overflow-auto p-4">
      <NSpin :show="loading">
        <NCard v-if="devices.length === 0 && !loading">
          <NEmpty description="暂无设备" />
        </NCard>
        <NDataTable v-else :columns="columns" :data="devices" :row-key="(row: Device) => row.name || row.id" />
      </NSpin>
    </main>

    <NModal v-model:show="showModal" preset="card" title="编辑设备" style="width: 500px">
      <NSpace vertical>
        <div v-for="(_, key) in editForm" :key="key">
          <label class="block mb-1 text-sm">{{ key }}</label>
          <NInput v-model:value="editForm[key]" />
        </div>
      </NSpace>
      <template #footer>
        <NSpace justify="end">
          <NButton @click="closeModal">取消</NButton>
          <NButton type="primary" @click="saveDevice">保存</NButton>
        </NSpace>
      </template>
    </NModal>
  </div>
</template>
