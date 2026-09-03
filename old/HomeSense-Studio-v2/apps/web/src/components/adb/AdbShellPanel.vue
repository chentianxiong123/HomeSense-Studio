<script setup lang="ts">
import TerminalPanel from '@/components/TerminalPanel.vue'

defineProps<{
  deviceId: number
  canOpenConsole: boolean
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  openConsole: []
}>()
</script>

<template>
  <div class="surface terminal-surface">
    <div class="surface-head">
      <h3>{{ label('ADB 终端', 'ADB Shell') }}</h3>
      <button class="ghost-btn" @click="emit('openConsole')">{{ label('全屏', 'Fullscreen') }}</button>
    </div>
    <TerminalPanel v-if="canOpenConsole" :target-device-id="deviceId" height="360px" :font-size="12" />
    <div v-else class="empty-line">{{ label('该设备未配置终端目标。', 'No terminal target is configured for this device.') }}</div>
  </div>
</template>

<style scoped>
.surface {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 16px;
}

.terminal-surface {
  min-height: 320px;
}

.surface-head {
  margin-bottom: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

h3 {
  margin: 0;
  color: #0f172a;
  font-size: 15px;
  letter-spacing: 0;
}

.ghost-btn {
  padding: 7px 11px;
}

.ghost-btn:hover:not(:disabled) {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

.empty-line {
  padding: 36px 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
}

@media (max-width: 900px) {
  .surface-head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
