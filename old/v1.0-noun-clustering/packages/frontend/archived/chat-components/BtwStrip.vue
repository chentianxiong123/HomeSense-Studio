<script setup lang="ts">
import { computed } from 'vue'

interface BtwItem {
  id: string
  kind: string
  text: string
  ts: number
}

const props = defineProps<{ items: BtwItem[] }>()
const emit = defineEmits<{ (e: 'dismiss', id: string): void }>()

const recent = computed(() => props.items.slice(-3))
</script>

<template>
  <div v-if="recent.length > 0" class="btw-strip">
    <div
      v-for="item in recent"
      :key="item.id"
      :class="['btw-chip', `kind-${item.kind}`]"
    >
      <span class="btw-kind">{{ item.kind }}</span>
      <span class="btw-text">{{ item.text }}</span>
      <button class="btw-dismiss" @click="emit('dismiss', item.id)">×</button>
    </div>
  </div>
</template>

<style scoped>
.btw-strip {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  background: transparent;
}

.btw-chip {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-radius: 12px;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(229, 231, 235, 0.5);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
  color: var(--text-primary);
  transition: all 0.3s cubic-bezier(0.23, 1, 0.32, 1);
  overflow: hidden;
  position: relative;
}

.btw-chip:hover {
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
  transform: translateX(4px);
  background: #fff;
}

.btw-chip::before {
  content: "";
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 4px;
  background: #cbd5e1;
}

.btw-chip.kind-cron_fired::before { background: #3b82f6; }
.btw-chip.kind-memory_observation::before { background: #8b5cf6; }
.btw-chip.kind-service_called::before { background: #10a37f; }
.btw-chip.kind-workflow_completed::before { background: #f59e0b; }

.btw-kind {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  font-weight: 800;
  color: var(--text-tertiary);
  min-width: 90px;
  background: rgba(0,0,0,0.05);
  padding: 2px 6px;
  border-radius: 4px;
}

.btw-text {
  flex: 1 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.btw-dismiss {
  border: none;
  background: rgba(241, 245, 249, 0.8);
  color: var(--text-tertiary);
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  font-size: 14px;
  cursor: pointer;
  line-height: 1;
  transition: all 0.2s ease;
}

.btw-dismiss:hover {
  background: #f1f5f9;
  color: #ef4444;
  transform: rotate(90deg);
}
</style>
