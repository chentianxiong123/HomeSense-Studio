<script setup lang="ts">
import type { ApprovalRequest } from '../../types/chat'
import { useLocale } from '../../composables/useLocale'

defineProps<{ request: ApprovalRequest }>()
const emit = defineEmits<{ (e: 'resolve', approvalId: string, decision: 'approved' | 'denied'): void }>()
const { t } = useLocale()

function stringify(value: unknown): string {
  if (value == null) return ''
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}
</script>

<template>
  <div :class="['approval-card', request.resolved ?? 'pending']">
    <div class="approval-head">
      <span class="approval-kind">{{ t('approval.title') }}</span>
      <span class="approval-reason">{{ request.reason }}</span>
    </div>
    <pre v-if="request.payload" class="approval-payload">{{ stringify(request.payload) }}</pre>
    <div v-if="!request.resolved" class="approval-actions">
      <button type="button" class="btn approve" @click="emit('resolve', request.approval_id, 'approved')">{{ t('approval.approve') }}</button>
      <button type="button" class="btn deny" @click="emit('resolve', request.approval_id, 'denied')">{{ t('approval.deny') }}</button>
    </div>
    <div v-else class="approval-resolved">{{ request.resolved }}</div>
  </div>
</template>

<style scoped>
.approval-card {
  border: 1px solid rgba(245, 158, 11, 0.4);
  border-radius: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(245, 158, 11, 0.05);
  transition: all 0.3s ease;
}
.approval-card:hover { transform: translateY(-2px); box-shadow: 0 12px 24px rgba(245, 158, 11, 0.1); }

.approval-card.approved { border-color: rgba(16, 185, 129, 0.4); background: rgba(240, 253, 244, 0.6); box-shadow: 0 4px 12px rgba(16, 185, 129, 0.05); }
.approval-card.denied { border-color: rgba(220, 38, 38, 0.4); background: rgba(254, 242, 242, 0.6); box-shadow: 0 4px 12px rgba(220, 38, 38, 0.05); }

.approval-head { display: flex; align-items: center; gap: 10px; }
.approval-kind {
  font-size: 9px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: #b45309;
  background: rgba(245, 158, 11, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
}
.approval-reason { font-size: 14px; font-weight: 700; color: var(--text-primary); letter-spacing: -0.01em; }
.approval-payload {
  margin: 0;
  padding: 12px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(229, 231, 235, 0.5);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 11px;
  max-height: 250px;
  overflow: auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  color: var(--text-secondary);
}
.approval-actions { display: flex; gap: 10px; margin-top: 4px; }
.btn {
  padding: 8px 20px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}
.btn.approve { background: var(--primary-color); color: white; box-shadow: 0 4px 12px rgba(16, 183, 127, 0.2); }
.btn.approve:hover { background: var(--primary-hover); transform: translateY(-1px); }
.btn.deny { background: white; color: #dc2626; border-color: rgba(220, 38, 38, 0.2); }
.btn.deny:hover { background: rgba(254, 242, 242, 1); transform: translateY(-1px); }

.approval-resolved {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-tertiary);
  text-align: right;
}
</style>
