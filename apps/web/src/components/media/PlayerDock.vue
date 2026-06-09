<script setup lang="ts">
import { computed } from 'vue'
import { useMediaPlayer } from '@/features/media/player'
import type { MediaPlayMode } from '@/features/media/types'

const player = useMediaPlayer()
const item = player.currentItem
const state = player.state

const durationLabel = computed(() => formatTime(state.session.duration_sec || item.value?.duration_sec || 0))
const positionLabel = computed(() => formatTime(state.session.position_sec))
const isPlaying = computed(() => state.session.state === 'playing' || state.session.state === 'loading')
const playModeLabel = computed(() => {
  const map: Record<MediaPlayMode, string> = {
    order: '顺序播放',
    loop: '列表循环',
    single: '单曲循环',
    random: '随机播放',
  }
  return map[state.playMode]
})
const stateLabel = computed(() => {
  const map = {
    idle: '待机',
    loading: '载入中',
    playing: '播放中',
    paused: '已暂停',
    stopped: '已停止',
    error: '播放失败',
  }
  return map[state.session.state] ?? state.session.state
})

function handleSeek(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) player.seekToPercent(value)
}

function handleVolume(event: Event) {
  const value = Number((event.target as HTMLInputElement).value)
  if (Number.isFinite(value)) player.setVolume(value)
}

function togglePlayMode() {
  const modes: MediaPlayMode[] = ['order', 'loop', 'single', 'random']
  const currentIndex = modes.indexOf(state.playMode)
  player.setPlayMode(modes[(currentIndex + 1) % modes.length] || 'loop')
}

function formatTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '0:00'
  const seconds = Math.floor(totalSeconds)
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}
</script>

<template>
  <Transition name="media-dock">
    <section v-if="item" class="media-player-dock" aria-label="Media player">
      <button class="media-main" type="button" title="当前媒体">
        <img v-if="item.cover" class="media-cover" :src="item.cover" :alt="item.title" referrerpolicy="no-referrer" />
        <span v-else class="media-cover fallback" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M9 18V5l12-2v13" />
            <circle cx="6" cy="18" r="3" />
            <circle cx="18" cy="16" r="3" />
          </svg>
        </span>
        <span class="media-copy">
          <strong>{{ item.title }}</strong>
          <small>{{ item.artist || state.session.output.name }} · {{ stateLabel }}</small>
        </span>
      </button>

      <div class="media-progress">
        <span>{{ positionLabel }}</span>
        <input
          type="range"
          min="0"
          max="100"
          step="0.1"
          :value="player.progress.value"
          title="进度"
          @input="handleSeek"
        />
        <span>{{ durationLabel }}</span>
      </div>

      <div class="media-controls">
        <button type="button" class="icon-btn mode-btn" :title="playModeLabel" @click="togglePlayMode">
          <svg v-if="state.playMode === 'random'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M16 3h5v5" />
            <path d="M4 20 21 3" />
            <path d="M21 16v5h-5" />
            <path d="M15 15 21 21" />
            <path d="M4 4l5 5" />
          </svg>
          <svg v-else-if="state.playMode === 'single'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m17 2 4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="m7 22-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
            <path d="M11 10h1v4" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="m17 2 4 4-4 4" />
            <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
            <path d="m7 22-4-4 4-4" />
            <path d="M21 13v1a4 4 0 0 1-4 4H3" />
          </svg>
        </button>
        <button type="button" class="icon-btn" title="上一首" :disabled="!player.hasPrevious.value" @click="player.previous()">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="m19 20-9-8 9-8v16Z" />
            <path d="M5 19V5" />
          </svg>
        </button>
        <button type="button" class="play-btn" title="播放/暂停" @click="player.toggle()">
          <svg v-if="isPlaying" viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M7 5h3v14H7zM14 5h3v14h-3z" />
          </svg>
          <svg v-else viewBox="0 0 24 24" width="22" height="22" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
        <button type="button" class="icon-btn" title="下一首" :disabled="!player.hasNext.value" @click="player.next()">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
            <path d="m5 4 9 8-9 8V4Z" />
            <path d="M19 5v14" />
          </svg>
        </button>
        <button type="button" class="icon-btn" title="停止" @click="player.stop()">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
            <path d="M7 7h10v10H7z" />
          </svg>
        </button>
      </div>

      <div class="media-volume">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M11 5 6 9H3v6h3l5 4V5Z" />
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </svg>
        <input type="range" min="0" max="100" :value="state.session.volume" title="音量" @input="handleVolume" />
      </div>
    </section>
  </Transition>
</template>

<style scoped>
.media-player-dock {
  position: fixed;
  left: calc(18px + var(--app-safe-left));
  right: calc(18px + var(--app-safe-right));
  bottom: calc(18px + var(--app-safe-bottom));
  z-index: 850;
  min-height: 72px;
  padding: 10px 12px;
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 16px 42px rgba(15, 23, 42, 0.13);
  backdrop-filter: blur(24px);
  display: grid;
  grid-template-columns: minmax(220px, 1.2fr) minmax(220px, 1fr) auto minmax(110px, 0.4fr);
  gap: 12px;
  align-items: center;
}

.media-main {
  min-width: 0;
  border: 0;
  background: transparent;
  display: flex;
  align-items: center;
  gap: 10px;
  text-align: left;
}

.media-cover {
  width: 48px;
  height: 48px;
  border-radius: 6px;
  object-fit: cover;
  background: #e2e8f0;
  flex: 0 0 auto;
}

.media-cover.fallback {
  color: #0f766e;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.media-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.media-copy strong,
.media-copy small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media-copy strong {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
  letter-spacing: 0;
}

.media-copy small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 750;
}

.media-progress,
.media-volume,
.media-controls {
  display: flex;
  align-items: center;
}

.media-progress {
  gap: 8px;
}

.media-progress span {
  width: 38px;
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  font-weight: 800;
}

.media-progress span:first-child {
  text-align: right;
}

input[type='range'] {
  min-width: 0;
  width: 100%;
  accent-color: #0f766e;
}

.media-controls {
  gap: 6px;
}

.icon-btn,
.play-btn {
  border: 1px solid #dbe3ec;
  border-radius: 8px;
  background: #fff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.icon-btn {
  width: 36px;
  height: 36px;
}

.play-btn {
  width: 42px;
  height: 42px;
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

.icon-btn:hover:not(:disabled),
.play-btn:hover:not(:disabled) {
  transform: translateY(-1px);
}

.icon-btn:disabled {
  cursor: not-allowed;
  opacity: 0.38;
}

.media-volume {
  min-width: 0;
  gap: 8px;
  color: var(--text-tertiary);
}

.media-dock-enter-active,
.media-dock-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}

.media-dock-enter-from,
.media-dock-leave-to {
  opacity: 0;
  transform: translateY(16px);
}

@media (max-width: 900px) {
  .media-player-dock {
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
  }

  .media-progress,
  .media-volume {
    display: none;
  }
}

@media (max-width: 560px) {
  .media-player-dock {
    left: calc(10px + var(--app-safe-left));
    right: calc(10px + var(--app-safe-right));
    bottom: calc(10px + var(--app-safe-bottom));
    padding: 8px;
    gap: 8px;
  }

  .media-cover {
    width: 42px;
    height: 42px;
  }

  .media-controls {
    gap: 4px;
  }

  .icon-btn {
    width: 32px;
    height: 32px;
  }

  .play-btn {
    width: 38px;
    height: 38px;
  }

  .media-controls .icon-btn:first-child,
  .media-controls .mode-btn,
  .media-controls .icon-btn:last-child {
    display: none;
  }
}
</style>
