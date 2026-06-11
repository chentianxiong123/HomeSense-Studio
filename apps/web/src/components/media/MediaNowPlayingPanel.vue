<script setup lang="ts">
import type { MediaItem, MediaPlayMode, MediaSession } from '@/features/media/types'

defineProps<{
  activeItem: MediaItem | null
  session: MediaSession
  progress: number
  playMode: MediaPlayMode
  playModeLabel: string
  canControl: boolean
  hasPrevious: boolean
  hasNext: boolean
  label: (zh: string, en: string) => string
  sourceLabel: (source: string) => string
  formatTime: (seconds: number) => string
}>()

const emit = defineEmits<{
  stop: []
  previous: []
  toggle: []
  next: []
  'toggle-play-mode': []
}>()
</script>

<template>
  <section class="panel session-panel">
    <div class="panel-head">
      <div>
        <span class="eyebrow inline">{{ label('会话', 'Session') }}</span>
        <h2>{{ label('当前播放', 'Now Playing') }}</h2>
      </div>
      <button class="plain-btn" type="button" :disabled="!canControl" @click="emit('stop')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">
          <path d="M7 7h10v10H7z" />
        </svg>
        {{ label('停止', 'Stop') }}
      </button>
    </div>

    <div v-if="activeItem" class="now-row">
      <span class="cover-fallback" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13" />
          <circle cx="6" cy="18" r="3" />
          <circle cx="18" cy="16" r="3" />
        </svg>
      </span>
      <div class="now-copy">
        <strong>{{ activeItem.title }}</strong>
        <span>{{ sourceLabel(activeItem.source) }} · {{ session.output.name }}</span>
      </div>
    </div>

    <div v-else class="empty-line">{{ label('暂无播放项', 'No active item') }}</div>

    <div class="session-meter">
      <div class="meter-track">
        <span :style="{ width: `${progress}%` }" />
      </div>
      <div class="meter-copy">
        <span>{{ formatTime(session.position_sec) }}</span>
        <span>{{ formatTime(session.duration_sec || activeItem?.duration_sec || 0) }}</span>
      </div>
    </div>

    <div class="transport-row">
      <button class="icon-btn" type="button" :title="playModeLabel" @click="emit('toggle-play-mode')">
        <svg v-if="playMode === 'random'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M16 3h5v5" />
          <path d="M4 20 21 3" />
          <path d="M21 16v5h-5" />
          <path d="M15 15 21 21" />
          <path d="M4 4l5 5" />
        </svg>
        <svg v-else-if="playMode === 'single'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m17 2 4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="m7 22-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
          <path d="M11 10h1v4" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="m17 2 4 4-4 4" />
          <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
          <path d="m7 22-4-4 4-4" />
          <path d="M21 13v1a4 4 0 0 1-4 4H3" />
        </svg>
      </button>
      <button class="icon-btn" type="button" :disabled="!hasPrevious" @click="emit('previous')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="m19 20-9-8 9-8v16Z" />
          <path d="M5 19V5" />
        </svg>
      </button>
      <button class="play-btn" type="button" :disabled="!canControl" @click="emit('toggle')">
        <svg v-if="session.state === 'playing' || session.state === 'loading'" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
        </svg>
        <svg v-else viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
          <path d="M8 5v14l11-7z" />
        </svg>
      </button>
      <button class="icon-btn" type="button" :disabled="!hasNext" @click="emit('next')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <path d="m5 4 9 8-9 8V4Z" />
          <path d="M19 5v14" />
        </svg>
      </button>
    </div>
    <div class="mode-line">{{ playModeLabel }}</div>
  </section>
</template>

<style scoped>
.panel {
  padding: 20px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.eyebrow {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

.eyebrow.inline {
  display: inline-flex;
  margin-bottom: 5px;
}

h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0;
}

.plain-btn,
.icon-btn,
.play-btn {
  border-radius: 8px;
  font-family: inherit;
  font-weight: 900;
  cursor: pointer;
}

.plain-btn {
  min-height: 38px;
  padding: 0 13px;
  border: 1px solid #cbd5e1;
  background: #fff;
  color: var(--text-secondary);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
}

.plain-btn:hover:not(:disabled) {
  border-color: #0f766e;
  color: #0f766e;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
}

.now-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #f8fafc;
}

.cover-fallback {
  width: 52px;
  height: 52px;
  border-radius: 8px;
  background: #e6fffb;
  color: #0f766e;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 auto;
}

.now-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.now-copy strong,
.now-copy span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.now-copy strong {
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 900;
}

.now-copy span {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
}

.empty-line {
  padding: 26px 18px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
  text-align: center;
}

.session-meter {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.meter-track {
  height: 8px;
  overflow: hidden;
  border-radius: 8px;
  background: #e2e8f0;
}

.meter-track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: #0f766e;
}

.meter-copy {
  display: flex;
  justify-content: space-between;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 800;
}

.transport-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.mode-line {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.icon-btn,
.play-btn {
  border: 1px solid #dbe3ec;
  background: #fff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.icon-btn {
  width: 40px;
  height: 40px;
}

.play-btn {
  width: 48px;
  height: 48px;
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

@media (max-width: 700px) {
  .panel-head {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
