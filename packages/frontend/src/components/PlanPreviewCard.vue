<script setup lang="ts">
import { ref, watchEffect } from 'vue'
import { executorApi, type PlanPreview } from '../api/executor'

const props = defineProps<{
  planId: string
  compact?: boolean
}>()

const preview = ref<PlanPreview | null>(null)
const loading = ref(false)

watchEffect(async () => {
  if (!props.planId) {
    preview.value = null
    return
  }

  loading.value = true
  try {
    const result = await executorApi.getPlan(props.planId)
    preview.value = result.data
  } catch {
    preview.value = null
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div class="plan-preview-card">
    <div class="card-head">
      <div>
        <div class="eyebrow">Compiled Plan</div>
        <h5>{{ preview?.plan.name || planId }}</h5>
      </div>
      <span
        v-if="preview"
        :class="['status-badge', preview.executable ? 'ready' : 'blocked']"
      >
        {{ preview.executable ? 'Executable' : 'Missing Executors' }}
      </span>
    </div>

    <div v-if="loading" class="empty">Loading plan…</div>
    <div v-else-if="!preview" class="empty">Plan preview unavailable.</div>
    <template v-else>
      <p class="description">{{ preview.plan.description }}</p>
      <div class="steps">
        <div
          v-for="step in preview.steps"
          :key="step.order"
          class="step"
        >
          <span class="order">{{ step.order }}</span>
          <div class="step-body">
            <div class="step-title">{{ step.tool }}.{{ step.action }}</div>
            <div class="step-meta">{{ step.proposed_executor || 'unmapped' }}</div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.plan-preview-card {
  padding: 24px;
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(32px);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.04);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.plan-preview-card:hover { transform: translateY(-4px); box-shadow: 0 16px 40px rgba(0, 0, 0, 0.08); background: rgba(255, 255, 255, 0.85); border-color: rgba(16, 185, 129, 0.25); }

.card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.eyebrow {
  font-size: 13px;
  color: var(--text-tertiary);
  text-transform: uppercase;
  font-weight: 800;
  letter-spacing: 0.1em;
}

.card-head h5 {
  margin: 6px 0 0;
  font-size: 18px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.status-badge {
  padding: 4px 12px;
  border-radius: 99px;
  font-size: 13px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  white-space: nowrap;
}

.status-badge.ready {
  background: rgba(16, 185, 129, 0.15);
  color: #059669;
  border: 1px solid rgba(16, 185, 129, 0.2);
}

.status-badge.blocked {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
  border: 1px solid rgba(239, 68, 68, 0.2);
}

.description {
  margin: 0 0 20px;
  font-size: 16px;
  line-height: 1.6;
  color: var(--text-secondary);
  font-weight: 500;
}

.steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  background: rgba(248, 250, 252, 0.6);
  padding: 16px;
  border-radius: 12px;
  border: 1px solid rgba(229, 231, 235, 0.8);
}

.step {
  display: flex;
  gap: 14px;
  align-items: center;
  padding: 4px 0;
}

.order {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #fff;
  border: 1px solid rgba(229, 231, 235, 1);
  border-radius: 50%;
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 800;
  box-shadow: var(--shadow-sm);
}

.step-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.step-title {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-primary);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.step-meta {
  font-size: 14px;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.empty {
  padding: 32px;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-tertiary);
  background: rgba(248, 250, 252, 0.4);
  border-radius: 12px;
  border: 1px dashed rgba(229, 231, 235, 1);
}

</style>
