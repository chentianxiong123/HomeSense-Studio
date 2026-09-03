<script setup lang="ts">
export interface AdbScreenshot {
  base64?: string
  mime?: string
  width?: number
  height?: number
  size_bytes?: number
}

defineProps<{
  screenshot: AdbScreenshot | null
  screenshotSrc: string
  loading: boolean
  label: (zh: string, en: string) => string
  formatBytes: (value?: number) => string
}>()

const emit = defineEmits<{
  refresh: []
  tap: [event: MouseEvent]
}>()
</script>

<template>
  <div class="surface screen-surface">
    <div class="surface-head">
      <h3>{{ label('屏幕截图', 'Screen Capture') }}</h3>
      <button class="ghost-btn" :disabled="loading" @click="emit('refresh')">
        {{ loading ? label('截取中', 'Capturing') : label('刷新截图', 'Refresh') }}
      </button>
    </div>
    <div v-if="screenshotSrc" class="screen-stage">
      <img :src="screenshotSrc" :alt="label('ADB 截图', 'ADB screenshot')" @click="emit('tap', $event)" />
      <div class="screen-meta">
        <span>{{ screenshot?.width }} x {{ screenshot?.height }}</span>
        <span>{{ formatBytes(screenshot?.size_bytes) }}</span>
        <span>{{ label('点击图片可发送 tap', 'Click image to send tap') }}</span>
      </div>
    </div>
    <div v-else class="empty-line">{{ label('点击刷新截图读取当前屏幕。', 'Refresh to capture the current screen.') }}</div>
  </div>
</template>

<style scoped>
.surface {
  min-height: 320px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
  padding: 16px;
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

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.screen-stage {
  display: grid;
  grid-template-columns: minmax(220px, 360px) minmax(180px, 1fr);
  gap: 16px;
  align-items: start;
}

.screen-stage img {
  display: block;
  width: 100%;
  max-height: 560px;
  object-fit: contain;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  background: #0f172a;
  cursor: crosshair;
}

.screen-meta {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #475569;
  font-size: 13px;
  font-weight: 800;
}

.screen-meta span {
  display: inline-flex;
  width: fit-content;
  max-width: 100%;
  padding: 7px 10px;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  background: #fff;
  overflow-wrap: anywhere;
}

.empty-line {
  padding: 36px 0;
  color: #64748b;
  font-size: 14px;
  font-weight: 700;
  text-align: center;
}

@media (max-width: 720px) {
  .surface-head {
    align-items: stretch;
    flex-direction: column;
  }

  .screen-stage {
    grid-template-columns: 1fr;
  }
}
</style>
