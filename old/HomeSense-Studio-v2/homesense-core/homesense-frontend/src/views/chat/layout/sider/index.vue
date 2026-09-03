<script setup lang='ts'>
import type { CSSProperties } from 'vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NLayoutSider, NModal, NTag } from 'naive-ui'
import Footer from './Footer.vue'
import { fetchDevices, fetchExperiencePaths, fetchRules, fetchTools } from '@/api'
import { useAppStore, useRuntimePanelStore } from '@/store'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { PromptStore, SvgIcon } from '@/components/common'

interface SidebarRule {
  id?: number
  trigger: string
  response?: string
  enabled?: boolean
  actions?: Array<Record<string, any>>
  hit_count?: number
}

interface SidebarExperiencePath {
  id: string
  name: string
  input?: string
  reuseCount: number
  successRate: number
  intent?: string
  promotedRule?: boolean
}

interface SidebarDevice {
  id: string
  name: string
  type: string
  online: boolean
}

interface SidebarTool {
  name: string
  description: string
}

const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const runtimePanelStore = useRuntimePanelStore()

const { isMobile } = useBasicLayout()
const show = ref(false)
const showRulesModal = ref(false)
const showPathsModal = ref(false)
const showDevicesModal = ref(false)
const showToolsModal = ref(false)
const showWorkflowsModal = ref(false)
const showClustersModal = ref(false)
const loadingPanel = ref(false)
const rules = ref<SidebarRule[]>([])
const experiencePaths = ref<SidebarExperiencePath[]>([])
const devices = ref<SidebarDevice[]>([])
const tools = ref<SidebarTool[]>([])
const workflowCandidates = ref<Array<{ workflowId: string, name: string, status?: string, source?: string }>>([])
const clusters = ref<Array<{ clusterId: string, pathCount: number, avgSuccessRate?: number, topPath?: string }>>([])

const collapsed = computed(() => appStore.siderCollapsed)
const isChatRoute = computed(() => route.path.startsWith('/chat'))
const runtimeMeta = computed(() => runtimePanelStore.resolutionMeta)
const topRules = computed(() => [...rules.value]
  .sort((left, right) => (right.hit_count || 0) - (left.hit_count || 0))
  .slice(0, 5))
const topPaths = computed(() => [...experiencePaths.value]
  .sort((left, right) => (right.reuseCount || 0) - (left.reuseCount || 0))
  .slice(0, 5))

function handleUpdateCollapsed() {
  appStore.setSiderCollapsed(!collapsed.value)
}

async function loadRuntimePanelData() {
  if (!isChatRoute.value)
    return

  loadingPanel.value = true
  try {
    const results = await Promise.allSettled([
      fetchRules<any>(),
      fetchExperiencePaths<any>(),
      fetchDevices<any>(),
      fetchTools<any>(),
    ])
    const [rulesRes, pathsRes, devicesRes, toolsRes] = results

    if (rulesRes.status === 'fulfilled')
      rules.value = Array.isArray(rulesRes.value.data) ? rulesRes.value.data : []
    else
      console.error('Failed to load rules:', rulesRes.reason)

    if (pathsRes.status === 'fulfilled')
      experiencePaths.value = Array.isArray(pathsRes.value.data) ? pathsRes.value.data : []
    else
      console.error('Failed to load success paths:', pathsRes.reason)

    if (devicesRes.status === 'fulfilled')
      devices.value = Array.isArray(devicesRes.value.data) ? devicesRes.value.data : []
    else
      console.error('Failed to load devices:', devicesRes.reason)

    if (toolsRes.status === 'fulfilled')
      tools.value = Array.isArray(toolsRes.value.data) ? toolsRes.value.data : []
    else
      console.error('Failed to load tools:', toolsRes.reason)
  }
  catch (error) {
    console.error('Failed to load runtime sidebar data:', error)
  }
  finally {
    loadingPanel.value = false
  }
}

function formatPercent(value?: number) {
  return typeof value === 'number' ? `${Math.round(value * 100)}%` : 'n/a'
}

const getMobileClass = computed<CSSProperties>(() => {
  if (isMobile.value) {
    return {
      position: 'fixed',
      zIndex: 50,
    }
  }
  return {}
})

const mobileSafeArea = computed(() => {
  if (isMobile.value) {
    return {
      paddingBottom: 'env(safe-area-inset-bottom)',
    }
  }
  return {}
})

watch(
  isMobile,
  (val) => {
    appStore.setSiderCollapsed(val)
  },
  {
    immediate: true,
    flush: 'post',
  },
)

watch(
  () => route.fullPath,
  () => {
    if (isChatRoute.value)
      loadRuntimePanelData()
  },
  { immediate: true },
)

onMounted(() => {
  if (isChatRoute.value)
    loadRuntimePanelData()
})
</script>

<template>
  <NLayoutSider
    :collapsed="collapsed"
    :collapsed-width="0"
    :width="320"
    :show-trigger="isMobile ? false : 'arrow-circle'"
    collapse-mode="transform"
    position="absolute"
    bordered
    :style="getMobileClass"
    @update-collapsed="handleUpdateCollapsed"
  >
    <div class="flex flex-col h-full" :style="mobileSafeArea">
      <main class="flex flex-col flex-1 min-h-0">
        <div class="p-4">
          <h2 class="text-lg font-bold text-gray-800 dark:text-white">HomeSense</h2>
          <p class="text-xs text-gray-500 mt-1">智能家居控制中心</p>
        </div>

        <div v-if="isChatRoute" class="flex-1 min-h-0 overflow-y-auto px-4 pb-3 space-y-3">
          <div class="flex items-center justify-between">
            <div class="text-xs font-semibold text-gray-500 uppercase tracking-wide">运行看板</div>
            <NButton text size="tiny" @click="loadRuntimePanelData">
              <template #icon>
                <SvgIcon icon="ri:refresh-line" />
              </template>
            </NButton>
          </div>

          <div class="rounded border border-[#e5e7eb] bg-white/80 p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#151518]">
            <div class="mb-2 flex items-center justify-between">
              <div class="font-medium text-gray-800 dark:text-white">当前上下文</div>
            </div>
            <div class="space-y-2 text-neutral-500">
              <div>补全设备: {{ runtimeMeta?.currentCompletionDevice || '暂无' }}</div>
              <div>补全输入: {{ runtimeMeta?.completedInput || '暂无' }}</div>
            </div>
          </div>

          <div class="rounded border border-[#e5e7eb] bg-white/80 p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#151518]">
            <div class="mb-2 flex items-center justify-between">
              <div class="font-medium text-gray-800 dark:text-white">规则引擎表</div>
              <div class="text-neutral-400">{{ rules.length }}</div>
            </div>
            <div class="space-y-2 text-neutral-500">
              <div>已加载规则: {{ rules.length }}</div>
              <div>高频规则: {{ topRules.length }}</div>
              <div v-if="topRules[0]">最高命中: {{ topRules[0].trigger }}</div>
              <div v-else>最高命中: 暂无</div>
            </div>
            <div class="mt-3">
              <NButton block size="small" :disabled="loadingPanel || !rules.length" @click="showRulesModal = true">
                查看完整规则列表
              </NButton>
            </div>
          </div>

          <div class="rounded border border-[#e5e7eb] bg-white/80 p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#151518]">
            <div class="mb-2 flex items-center justify-between">
              <div class="font-medium text-gray-800 dark:text-white">成功经验表</div>
              <div class="text-neutral-400">{{ experiencePaths.length }}</div>
            </div>
            <div class="space-y-2 text-neutral-500">
              <div>已加载经验: {{ experiencePaths.length }}</div>
              <div>高频经验: {{ topPaths.length }}</div>
              <div v-if="topPaths[0]">最高复用: {{ topPaths[0].name }}</div>
              <div v-else>最高复用: 暂无</div>
            </div>
            <div class="mt-3">
              <NButton block size="small" :disabled="loadingPanel || !experiencePaths.length" @click="showPathsModal = true">
                查看完整成功经验列表
              </NButton>
            </div>
          </div>

          <div class="rounded border border-[#e5e7eb] bg-white/80 p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#151518]">
            <div class="mb-2 flex items-center justify-between">
              <div class="font-medium text-gray-800 dark:text-white">设备列表</div>
              <div class="text-neutral-400">{{ devices.length }}</div>
            </div>
            <div class="space-y-2 text-neutral-500">
              <div>在线设备: {{ devices.filter(d => d.online).length }}</div>
              <div>离线设备: {{ devices.filter(d => !d.online).length }}</div>
              <div v-if="devices[0]">设备1: {{ devices[0].name }}</div>
              <div v-else>暂无设备</div>
            </div>
            <div class="mt-3">
              <NButton block size="small" :disabled="loadingPanel || !devices.length" @click="showDevicesModal = true">
                查看完整设备列表
              </NButton>
            </div>
          </div>

          <div class="rounded border border-[#e5e7eb] bg-white/80 p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#151518]">
            <div class="mb-2 flex items-center justify-between">
              <div class="font-medium text-gray-800 dark:text-white">工具列表</div>
              <div class="text-neutral-400">{{ tools.length }}</div>
            </div>
            <div class="space-y-2 text-neutral-500">
              <div>已加载工具: {{ tools.length }}</div>
              <div v-if="tools[0]">工具1: {{ tools[0].name }}</div>
              <div v-else>暂无工具</div>
            </div>
            <div class="mt-3">
              <NButton block size="small" :disabled="loadingPanel || !tools.length" @click="showToolsModal = true">
                查看完整工具列表
              </NButton>
            </div>
          </div>

          <div class="rounded border border-[#e5e7eb] bg-white/80 p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#151518]">
            <div class="mb-2 flex items-center justify-between">
              <div class="font-medium text-gray-800 dark:text-white">工作流候选</div>
              <div class="text-neutral-400">{{ workflowCandidates.length }}</div>
            </div>
            <div class="space-y-2 text-neutral-500">
              <div>待处理: {{ workflowCandidates.length }}</div>
              <div v-if="workflowCandidates[0]">候选1: {{ workflowCandidates[0].name }}</div>
              <div v-else>暂无工作流候选</div>
            </div>
            <div class="mt-3">
              <NButton block size="small" :disabled="loadingPanel || !workflowCandidates.length" @click="showWorkflowsModal = true">
                查看完整工作流候选
              </NButton>
            </div>
          </div>

          <div class="rounded border border-[#e5e7eb] bg-white/80 p-3 text-xs dark:border-[#2a2a2d] dark:bg-[#151518]">
            <div class="mb-2 flex items-center justify-between">
              <div class="font-medium text-gray-800 dark:text-white">经验聚类</div>
              <div class="text-neutral-400">{{ clusters.length }}</div>
            </div>
            <div class="space-y-2 text-neutral-500">
              <div>聚类数: {{ clusters.length }}</div>
              <div v-if="clusters[0]">最大聚类: {{ clusters[0].pathCount }}条经验</div>
              <div v-else>暂无聚类</div>
            </div>
            <div class="mt-3">
              <NButton block size="small" :disabled="loadingPanel || !clusters.length" @click="showClustersModal = true">
                查看完整聚类列表
              </NButton>
            </div>
          </div>
        </div>

        <div v-else class="flex-1 min-h-0" />

        <div class="px-4 py-2 space-y-2">
          <NButton quaternary block @click="router.push('/chat')">
            <template #icon>
              <SvgIcon icon="ri:chat-1-line" />
            </template>
            对话
          </NButton>
          <NButton quaternary block @click="router.push('/devices')">
            <template #icon>
              <SvgIcon icon="ri:device-line" />
            </template>
            设备管理
          </NButton>
          <NButton quaternary block @click="router.push('/config')">
            <template #icon>
              <SvgIcon icon="ri:settings-3-line" />
            </template>
            工具配置
          </NButton>
        </div>
        <div class="p-4">
          <NButton block @click="show = true">
            提示词库
          </NButton>
        </div>
      </main>
      <Footer />
    </div>
  </NLayoutSider>

  <template v-if="isMobile">
    <div v-show="!collapsed" class="fixed inset-0 z-40 w-full h-full bg-black/40" @click="handleUpdateCollapsed" />
  </template>

  <NModal v-model:show="showRulesModal" preset="card" title="规则引擎完整列表" class="w-[90vw] max-w-5xl">
    <div class="space-y-3 text-sm">
      <div class="grid grid-cols-[2fr_0.7fr_0.7fr_1.6fr] gap-3 border-b border-[#eef0f3] pb-2 text-xs text-neutral-400 dark:border-[#2a2a2d]">
        <div>Trigger</div>
        <div>Hit</div>
        <div>Status</div>
        <div>Response</div>
      </div>
      <div v-if="!rules.length" class="text-neutral-400">暂无规则</div>
      <div v-else class="max-h-[70vh] overflow-y-auto space-y-2">
        <div
          v-for="rule in [...rules].sort((left, right) => (right.hit_count || 0) - (left.hit_count || 0))"
          :key="`${rule.id}-${rule.trigger}`"
          class="grid grid-cols-[2fr_0.7fr_0.7fr_1.6fr] gap-3 rounded bg-[#f6f8fa] px-3 py-2 dark:bg-[#1d1f23]"
        >
          <div class="break-all">{{ rule.trigger }}</div>
          <div>{{ rule.hit_count || 0 }}</div>
          <div>{{ rule.enabled === false ? 'off' : 'on' }}</div>
          <div class="break-words text-neutral-500">{{ rule.response || '-' }}</div>
        </div>
      </div>
    </div>
  </NModal>

  <NModal v-model:show="showPathsModal" preset="card" title="成功经验完整列表" class="w-[90vw] max-w-5xl">
    <div class="space-y-3 text-sm">
      <div class="grid grid-cols-[1.8fr_0.9fr_0.9fr_0.8fr_0.8fr] gap-3 border-b border-[#eef0f3] pb-2 text-xs text-neutral-400 dark:border-[#2a2a2d]">
        <div>Path</div>
        <div>Intent</div>
        <div>Reuse</div>
        <div>Success</div>
        <div>Type</div>
      </div>
      <div v-if="!experiencePaths.length" class="text-neutral-400">暂无经验</div>
      <div v-else class="max-h-[70vh] overflow-y-auto space-y-2">
        <div
          v-for="path in [...experiencePaths].sort((left, right) => (right.reuseCount || 0) - (left.reuseCount || 0))"
          :key="path.id"
          class="grid grid-cols-[1.8fr_0.9fr_0.9fr_0.8fr_0.8fr] gap-3 rounded bg-[#f6f8fa] px-3 py-2 dark:bg-[#1d1f23]"
        >
          <div class="break-words">{{ path.name }}</div>
          <div>{{ path.intent || 'unknown' }}</div>
          <div>{{ path.reuseCount }}</div>
          <div>{{ formatPercent(path.successRate) }}</div>
          <div>{{ path.promotedRule ? 'rule' : 'path' }}</div>
        </div>
      </div>
    </div>
  </NModal>

  <NModal v-model:show="showDevicesModal" preset="card" title="设备完整列表" class="w-[90vw] max-w-2xl">
    <div class="space-y-3 text-sm">
      <div class="grid grid-cols-[1fr_1fr_0.6fr_0.6fr] gap-3 border-b border-[#eef0f3] pb-2 text-xs text-neutral-400 dark:border-[#2a2a2d]">
        <div>ID</div>
        <div>Name</div>
        <div>Type</div>
        <div>Status</div>
      </div>
      <div v-if="!devices.length" class="text-neutral-400">暂无设备</div>
      <div v-else class="max-h-[70vh] overflow-y-auto space-y-2">
        <div
          v-for="device in devices"
          :key="device.id"
          class="grid grid-cols-[1fr_1fr_0.6fr_0.6fr] gap-3 rounded bg-[#f6f8fa] px-3 py-2 dark:bg-[#1d1f23]"
        >
          <div class="break-words">{{ device.id }}</div>
          <div>{{ device.name }}</div>
          <div>{{ device.type }}</div>
          <div>
            <NTag :type="device.online ? 'success' : 'error'" size="small">
              {{ device.online ? '在线' : '离线' }}
            </NTag>
          </div>
        </div>
      </div>
    </div>
  </NModal>

  <NModal v-model:show="showToolsModal" preset="card" title="工具完整列表" class="w-[90vw] max-w-2xl">
    <div class="space-y-3 text-sm">
      <div class="grid grid-cols-[1fr_2fr] gap-3 border-b border-[#eef0f3] pb-2 text-xs text-neutral-400 dark:border-[#2a2a2d]">
        <div>Name</div>
        <div>Description</div>
      </div>
      <div v-if="!tools.length" class="text-neutral-400">暂无工具</div>
      <div v-else class="max-h-[70vh] overflow-y-auto space-y-2">
        <div
          v-for="tool in tools"
          :key="tool.name"
          class="grid grid-cols-[1fr_2fr] gap-3 rounded bg-[#f6f8fa] px-3 py-2 dark:bg-[#1d1f23]"
        >
          <div class="break-words font-medium">{{ tool.name }}</div>
          <div class="break-words text-neutral-500">{{ tool.description || '-' }}</div>
        </div>
      </div>
    </div>
  </NModal>

  <NModal v-model:show="showWorkflowsModal" preset="card" title="工作流候选列表" class="w-[90vw] max-w-5xl">
    <div class="space-y-3 text-sm">
      <div class="grid grid-cols-[1fr_1fr_0.8fr_0.8fr] gap-3 border-b border-[#eef0f3] pb-2 text-xs text-neutral-400 dark:border-[#2a2a2d]">
        <div>ID</div>
        <div>Name</div>
        <div>Status</div>
        <div>Source</div>
      </div>
      <div v-if="!workflowCandidates.length" class="text-neutral-400">暂无工作流候选</div>
      <div v-else class="max-h-[70vh] overflow-y-auto space-y-2">
        <div
          v-for="wf in workflowCandidates"
          :key="wf.workflowId"
          class="grid grid-cols-[1fr_1fr_0.8fr_0.8fr] gap-3 rounded bg-[#f6f8fa] px-3 py-2 dark:bg-[#1d1f23]"
        >
          <div class="break-words text-xs">{{ wf.workflowId }}</div>
          <div class="break-words">{{ wf.name }}</div>
          <div>
            <NTag :type="wf.status === 'accepted' ? 'success' : 'warning'" size="small">
              {{ wf.status || 'pending' }}
            </NTag>
          </div>
          <div>{{ wf.source || '-' }}</div>
        </div>
      </div>
    </div>
  </NModal>

  <NModal v-model:show="showClustersModal" preset="card" title="经验聚类列表" class="w-[90vw] max-w-3xl">
    <div class="space-y-3 text-sm">
      <div class="grid grid-cols-[1fr_0.8fr_0.8fr_2fr] gap-3 border-b border-[#eef0f3] pb-2 text-xs text-neutral-400 dark:border-[#2a2a2d]">
        <div>ClusterID</div>
        <div>PathCount</div>
        <div>AvgSuccess</div>
        <div>TopPath</div>
      </div>
      <div v-if="!clusters.length" class="text-neutral-400">暂无聚类</div>
      <div v-else class="max-h-[70vh] overflow-y-auto space-y-2">
        <div
          v-for="cluster in clusters"
          :key="cluster.clusterId"
          class="grid grid-cols-[1fr_0.8fr_0.8fr_2fr] gap-3 rounded bg-[#f6f8fa] px-3 py-2 dark:bg-[#1d1f23]"
        >
          <div class="break-words">{{ cluster.clusterId }}</div>
          <div>{{ cluster.pathCount }}</div>
          <div>{{ formatPercent(cluster.avgSuccessRate) }}</div>
          <div class="break-words text-neutral-500">{{ cluster.topPath || '-' }}</div>
        </div>
      </div>
    </div>
  </NModal>

  <PromptStore v-model:visible="show" />
</template>
