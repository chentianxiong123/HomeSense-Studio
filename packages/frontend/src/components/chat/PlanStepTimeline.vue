<script setup lang="ts">
import type { PlanStep } from '../../types/chat'
import { useLocale } from '../../composables/useLocale'

defineProps<{ steps: PlanStep[] }>()
const { t } = useLocale()
</script>

<template>
  <div v-if="steps.length > 0" class="plan-timeline">
    <div class="plan-timeline-head">{{ t('plan.steps') }}</div>
    <ol class="plan-timeline-list">
      <li
        v-for="step in steps"
        :key="`${step.plan_id}-${step.step_order}`"
        :class="['plan-step', step.status]"
      >
        <span class="plan-step-index">{{ step.step_order }}</span>
        <span class="plan-step-body">
          <span class="plan-step-tool">{{ step.tool }}.{{ step.action }}</span>
          <span v-if="step.error" class="plan-step-error">{{ step.error }}</span>
        </span>
        <span :class="['plan-step-status', step.status]">{{ t(`plan.status.${step.status}` as any) }}</span>
      </li>
    </ol>
  </div>
</template>

<style scoped>
.plan-timeline {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(12px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}
.plan-timeline-head {
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  color: var(--text-tertiary);
  margin-bottom: 12px;
}
.plan-timeline-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.plan-step {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  font-size: 16px;
  padding: 8px 12px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.8);
  border: 1px solid rgba(229, 231, 235, 0.5);
  transition: all 0.2s;
}
.plan-step:hover { transform: translateX(2px); border-color: var(--primary-color); }
.plan-step.running { border-color: rgba(37, 99, 235, 0.2); background: rgba(240, 249, 255, 0.8); }
.plan-step.success { border-color: rgba(16, 185, 129, 0.2); background: rgba(240, 253, 244, 0.8); }
.plan-step.error { border-color: rgba(220, 38, 38, 0.2); background: rgba(254, 242, 242, 0.8); }

.plan-step-index {
  font-weight: 800;
  color: var(--text-tertiary);
  font-size: 14px;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0,0,0,0.05);
  border-radius: 50%;
}
.plan-step-body { display: flex; flex-direction: column; min-width: 0; }
.plan-step-tool {
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.01em;
  overflow-wrap: anywhere;
}
.plan-step-error {
  font-size: 15px;
  font-weight: 500;
  color: #dc2626;
  margin-top: 4px;
  overflow-wrap: anywhere;
}
.plan-step-status {
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 2px 8px;
  border-radius: 999px;
}
.plan-step-status.running { background: rgba(37, 99, 235, 0.1); color: #2563eb; }
.plan-step-status.success { background: rgba(16, 185, 129, 0.1); color: #059669; }
.plan-step-status.error { background: rgba(220, 38, 38, 0.1); color: #dc2626; }
</style>
