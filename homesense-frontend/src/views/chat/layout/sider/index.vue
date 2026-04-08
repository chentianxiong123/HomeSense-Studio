<script setup lang='ts'>
import type { CSSProperties } from 'vue'
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { NButton, NLayoutSider, NModal } from 'naive-ui'
import Footer from './Footer.vue'
import { fetchExperiencePaths, fetchRules } from '@/api'
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

const router = useRouter()
const route = useRoute()
const appStore = useAppStore()
const runtimePanelStore = useRuntimePanelStore()

const { isMobile } = useBasicLayout()
const show = ref(false)
const showRulesModal = ref(false)
const showPathsModal = ref(false)
const loadingPanel = ref(false)
const rules = ref<SidebarRule[]>([])
const experiencePaths = ref<SidebarExperiencePath[]>([])

const collapsed = computed(() => appStore.siderCollapsed)
const isChatRoute = computed(() => route.path.startsWith('/chat'))
const runtimeTrace = computed(() => runtimePanelStore.trace || [])
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
    const [rulesRes, pathsRes] = await Promise.all([
      fetchRules<any>(),
      fetchExperiencePaths<any>(),
    ])
    rules.value = Array.isArray(rulesRes.data) ? rulesRes.data : []
    experiencePaths.value = Array.isArray(pathsRes.data) ? pathsRes.data : []
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
            <div class="font-medium text-gray-800 dark:text-white">当前链路</div>
            <div v-if="runtimePanelStore.latestAt" class="mt-1 text-neutral-500">{{ runtimePanelStore.latestAt }}</div>
            <div v-if="runtimeMeta" class="mt-2 space-y-1 text-neutral-600 dark:text-neutral-300">
              <div>来源: {{ runtimeMeta.resolutionSource || 'unknown' }}</div>
              <div>结果: {{ runtimeMeta.outcomeType || 'unknown' }}</div>
              <div>命中: {{ runtimeMeta.matched ? 'yes' : 'no' }}</div>
              <div v-if="runtimeMeta.matchedTrigger">规则: {{ runtimeMeta.matchedTrigger }}</div>
              <div v-if="runtimeMeta.matchedPathName">经验: {{ runtimeMeta.matchedPathName }}</div>
              <div v-if="runtimeMeta.deepMatchedPathName">Deep: {{ runtimeMeta.deepMatchedPathName }}</div>
              <div v-if="runtimeMeta.gatingReason">约束: {{ runtimeMeta.gatingReason }}</div>
            </div>
            <div v-if="runtimeTrace.length" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="item in runtimeTrace"
                :key="`${item.stage}-${item.next}`"
                class="rounded px-2 py-0.5"
                :class="item.ok ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'"
              >
                {{ item.stage }}
              </span>
            </div>
            <div v-if="!runtimeMeta && !runtimeTrace.length" class="mt-2 text-neutral-400">暂无最新链路</div>
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

  <PromptStore v-model:visible="show" />
</template>
