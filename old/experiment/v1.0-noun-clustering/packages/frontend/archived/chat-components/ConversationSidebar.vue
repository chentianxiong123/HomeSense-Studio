<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { api, type Conversation } from '../../api'
import { useLocale } from '../../composables/useLocale'

const props = defineProps<{ activeId?: number }>()
const emit = defineEmits<{
  (e: 'select', id: number): void
  (e: 'new'): void
}>()

const conversations = ref<Conversation[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const { t } = useLocale()

async function refresh() {
  loading.value = true
  error.value = null
  try {
    const result = await api.chat.history()
    if ('conversations' in result) {
      conversations.value = result.conversations
    }
  } catch (err) {
    error.value = (err as Error).message
  } finally {
    loading.value = false
  }
}

function summaryFor(c: Conversation): string {
  return c.summary?.trim() || c.last_intent?.trim() || `${t('conv.title')} #${c.id}`
}

function formatTime(raw?: string): string {
  if (!raw) return ''
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return ''
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
}

onMounted(refresh)
watch(() => props.activeId, refresh)
defineExpose({ refresh })
</script>

<template>
  <div class="conv-sidebar">
    <div class="head">
      <span class="title">{{ t('conv.title') }}</span>
      <div class="actions">
        <button class="mini" :disabled="loading" @click="refresh">↻</button>
        <button class="mini primary" @click="emit('new')">+ {{ t('conv.new') }}</button>
      </div>
    </div>
    <div v-if="error" class="error">{{ error }}</div>
    <div v-if="!loading && conversations.length === 0" class="empty">{{ t('conv.empty') }}</div>
    <ul class="list">
      <li
        v-for="c in conversations"
        :key="c.id"
        :class="['item', activeId === c.id && 'active']"
        @click="emit('select', c.id)"
      >
        <div class="item-head">
          <span class="item-id">#{{ c.id }}</span>
          <span class="item-time">{{ formatTime(c.updated_at) }}</span>
        </div>
        <div class="item-summary">{{ summaryFor(c) }}</div>
        <div v-if="c.last_plan_id" class="item-plan">{{ t('conv.plan') }}: {{ c.last_plan_id }}</div>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.conv-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(24px);
  border-right: 1px solid rgba(229, 231, 235, 0.4);
}
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
}
.title {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text-tertiary);
}
.actions { display: flex; gap: 8px; }
.mini {
  padding: 5px 12px;
  font-size: 11px;
  font-weight: 700;
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.8);
  cursor: pointer;
  transition: all 0.2s;
  color: var(--text-secondary);
}
.mini:hover:not(:disabled) {
  background: #fff;
  transform: translateY(-1px);
  box-shadow: var(--shadow-sm);
}
.mini.primary {
  background: var(--primary-color);
  color: white;
  border-color: var(--primary-color);
  box-shadow: 0 4px 12px rgba(16, 163, 127, 0.2);
}
.mini.primary:hover:not(:disabled) {
  background: var(--primary-hover);
}
.error {
  font-size: 11px;
  color: #dc2626;
  background: rgba(254, 242, 242, 0.8);
  padding: 10px 16px;
  margin: 10px;
  border-radius: 10px;
  font-weight: 500;
}
.empty {
  font-size: 13px;
  color: var(--text-tertiary);
  text-align: center;
  padding: 48px 20px;
  font-weight: 500;
}
.list {
  flex: 1;
  list-style: none;
  padding: 10px;
  margin: 0;
  overflow-y: auto;
}
.item {
  padding: 14px;
  border-radius: 12px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: all 0.2s;
  background: rgba(255, 255, 255, 0.4);
  border: 1px solid transparent;
}
.item:hover {
  background: #fff;
  border-color: rgba(229, 231, 235, 0.8);
  box-shadow: var(--shadow-sm);
  transform: translateX(4px);
}
.item.active {
  background: #fff;
  border-color: var(--primary-color);
  box-shadow: 0 4px 12px rgba(16, 163, 127, 0.1);
}
.item-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.item-id {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  font-weight: 800;
  color: var(--primary-color);
  background: rgba(16, 185, 129, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
}
.item-time {
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
}
.item-summary {
  font-size: 13px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  letter-spacing: -0.01em;
}
.item-plan {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  color: var(--text-tertiary);
  margin-top: 6px;
  display: flex;
  align-items: center;
  gap: 4px;
  text-transform: uppercase;
}
.item-plan::before {
  content: "📋";
  font-size: 10px;
}
</style>
