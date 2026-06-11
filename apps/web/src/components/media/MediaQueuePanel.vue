<script setup lang="ts">
import type { MediaItem } from '@/features/media/types'

defineProps<{
  queue: MediaItem[]
  currentIndex: number
  loading: boolean
  label: (zh: string, en: string) => string
  sourceLabel: (source: string) => string
}>()

const emit = defineEmits<{
  clear: []
  play: [index: number]
  move: [index: number, direction: -1 | 1]
  remove: [index: number]
}>()
</script>

<template>
  <section class="panel queue-panel">
    <div class="panel-head">
      <div>
        <span class="eyebrow inline">{{ label('队列', 'Queue') }}</span>
        <h2>{{ label('播放列表', 'Playlist') }}</h2>
      </div>
      <button class="plain-btn" type="button" :disabled="queue.length === 0 || loading" @click="emit('clear')">
        {{ loading ? label('加载中', 'Loading') : label('清空', 'Clear') }}
      </button>
    </div>

    <div v-if="queue.length > 0" class="queue-list">
      <div v-for="(queued, index) in queue" :key="queued.id" class="queue-row" :class="{ active: index === currentIndex }">
        <button class="queue-main" type="button" @click="emit('play', index)">
          <span>{{ index + 1 }}</span>
          <strong>{{ queued.title }}</strong>
          <small>{{ sourceLabel(queued.source) }}</small>
        </button>
        <div class="row-actions">
          <button class="row-icon" type="button" :disabled="index === 0" :title="label('上移', 'Move up')" @click="emit('move', index, -1)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
          <button class="row-icon" type="button" :disabled="index === queue.length - 1" :title="label('下移', 'Move down')" @click="emit('move', index, 1)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
          <button class="row-icon" type="button" :title="label('移除', 'Remove')" @click="emit('remove', index)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
    <div v-else class="empty-line">{{ label('队列为空', 'Queue is empty') }}</div>
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

.queue-panel {
  min-height: 260px;
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
.row-icon {
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

.queue-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.queue-row,
.empty-line {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
}

.queue-row {
  min-height: 48px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) max-content;
  align-items: center;
  gap: 8px;
  padding: 6px;
}

.queue-row.active {
  border-color: #99f6e4;
  background: #f0fdfa;
}

.queue-main {
  min-width: 0;
  border: 0;
  background: transparent;
  color: inherit;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
  text-align: left;
  cursor: pointer;
}

.queue-main span {
  color: var(--text-tertiary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  font-weight: 900;
  text-align: center;
}

.queue-main strong {
  min-width: 0;
  overflow: hidden;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 850;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.queue-main small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.row-icon {
  width: 32px;
  height: 32px;
  border: 1px solid #dbe3ec;
  background: #fff;
  color: #334155;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.row-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}

.empty-line {
  padding: 26px 18px;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
  text-align: center;
}

@media (max-width: 700px) {
  .panel-head {
    align-items: stretch;
    flex-direction: column;
  }

  .queue-row {
    grid-template-columns: 1fr;
  }

  .queue-main {
    grid-template-columns: 34px minmax(0, 1fr);
  }

  .queue-main small {
    grid-column: 2;
    justify-self: start;
  }

  .queue-row .row-actions {
    justify-content: flex-end;
  }
}
</style>
