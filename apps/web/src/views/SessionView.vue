<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { computed, ref } from 'vue'
import TerminalPanel from '@/components/TerminalPanel.vue'

const route = useRoute()
const router = useRouter()
const terminalPanel = ref<{ detach: () => void; terminate: () => void } | null>(null)

const targetId = computed(() => {
  const t = route.query.target_id
  if (typeof t === 'string' && t) return Number(t)
  return undefined
})
const targetDeviceId = computed(() => {
  const t = route.query.target_device_id
  if (typeof t === 'string' && t) return Number(t)
  return undefined
})

function back() {
  const from = typeof route.query.from === 'string' ? route.query.from : '/'
  router.push(from)
}

function detachAndBack() {
  terminalPanel.value?.detach()
  back()
}

function terminateAndBack() {
  terminalPanel.value?.terminate()
  back()
}
</script>

<template>
  <div class="session-view">
    <header class="session-view__bar">
      <button class="back-btn" @click="detachAndBack">← 暂离返回</button>
      <span class="title">终端会话</span>
      <button class="back-btn terminate-btn" @click="terminateAndBack">终止</button>
    </header>
    <TerminalPanel
      v-if="targetDeviceId"
      ref="terminalPanel"
      :target-device-id="targetDeviceId"
      height="100%"
      :show-header="false"
      :font-size="14"
    />
    <TerminalPanel
      v-else-if="targetId"
      ref="terminalPanel"
      :target-id="targetId"
      height="100%"
      :show-header="false"
      :font-size="14"
    />
    <TerminalPanel
      v-else
      ref="terminalPanel"
      :target="{ kind: 'local' }"
      label="Local Terminal"
      height="100%"
      :show-header="false"
      :font-size="14"
    />
  </div>
</template>

<style scoped>
.session-view {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a0a;
  color: #e5e5e5;
  border: none;
  border-radius: 0;
}
.session-view :deep(.terminal-panel) {
  border: none;
  border-radius: 0;
  flex: 1;
}
.session-view__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid #1f1f1f;
  font-size: 13px;
  font-family: ui-monospace, monospace;
  flex: 0 0 auto;
}
.back-btn {
  background: #1f1f1f;
  color: #e5e5e5;
  border: 1px solid #2a2a2a;
  border-radius: 4px;
  padding: 4px 10px;
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
}
.back-btn:hover { background: #2a2a2a; }
.terminate-btn {
  border-color: #7f1d1d;
  color: #fecaca;
}
.terminate-btn:hover {
  background: #450a0a;
}
.title {
  color: #737373;
  flex: 1;
}
</style>
