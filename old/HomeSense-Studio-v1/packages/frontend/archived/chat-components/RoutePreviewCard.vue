<script setup lang="ts">
import type { CandidatePlanPreview } from '../../types/chat'

defineProps<{
  normalizedIntent: string
  routeLevel: 1 | 2 | 3
  reason: string
  confidence: number
  allowToolCalls: boolean
  candidatePlans: CandidatePlanPreview[]
  routeEvidence?: Array<{ source: string; ref: string; score?: number; note?: string }>
  observations?: Array<{ id: string; name: string; score: number; last_action?: string; last_error?: string }>
  searchHits?: Array<{ id: string; type: string; source: string; score: number }>
}>()

function levelLabel(level: 1 | 2 | 3) {
  return { 1: 'L1', 2: 'L2', 3: 'L3' }[level]
}
</script>

<template>
  <section class="route-card">
    <div class="route-head">
      <span class="route-level">{{ levelLabel(routeLevel) }}</span>
      <code class="route-intent">{{ normalizedIntent }}</code>
    </div>
    <div class="route-meta">
      <span>{{ reason }}</span>
      <span>{{ confidence.toFixed(2) }}</span>
      <span>{{ allowToolCalls ? 'act' : 'explain' }}</span>
    </div>

    <div v-if="candidatePlans.length" class="candidate-list">
      <article
        v-for="plan in candidatePlans"
        :key="plan.id"
        class="candidate-item"
      >
        <div class="candidate-title-row">
          <strong>{{ plan.title }}</strong>
          <div class="candidate-right">
            <span class="candidate-kind">{{ plan.candidate_kind }}</span>
            <span class="candidate-confidence">{{ plan.confidence.toFixed(2) }}</span>
          </div>
        </div>
        <div class="candidate-goal">{{ plan.goal }}</div>
        <div v-if="plan.entities.length" class="candidate-tags">
          <span v-for="entity in plan.entities" :key="entity" class="tag">{{ entity }}</span>
        </div>
        <div v-if="plan.evidence.length" class="candidate-evidence">
          <span
            v-for="item in plan.evidence.slice(0, 2)"
            :key="`${item.source}:${item.ref}`"
            class="evidence-chip"
          >{{ item.source }}: {{ item.note ?? item.ref }}</span>
        </div>
      </article>
    </div>

    <div v-if="routeEvidence?.length" class="aux-block">
      <h4>Route Evidence</h4>
      <div class="aux-chip-list">
        <span
          v-for="item in routeEvidence"
          :key="`${item.source}:${item.ref}`"
          class="aux-chip"
        >{{ item.source }}: {{ item.note ?? item.ref }}</span>
      </div>
    </div>

    <div v-if="observations?.length" class="aux-block">
      <h4>Observations</h4>
      <div class="aux-list">
        <div v-for="item in observations" :key="item.id" class="aux-row">
          <strong>{{ item.name }}</strong>
          <span>{{ item.score.toFixed(2) }}</span>
        </div>
      </div>
    </div>

    <div v-if="searchHits?.length" class="aux-block">
      <h4>Search</h4>
      <div class="aux-list">
        <div v-for="item in searchHits" :key="item.id" class="aux-row">
          <strong>{{ item.type }}</strong>
          <span>{{ item.source }} {{ item.score.toFixed(2) }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.route-card {
  border: 1px solid rgba(229, 231, 235, 0.4);
  border-radius: 16px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.6);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}
.route-head {
  display: flex;
  align-items: center;
  gap: 10px;
}
.route-level {
  font-size: 9px;
  font-weight: 800;
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  border-radius: 4px;
  padding: 2px 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.route-intent {
  font-size: 11px;
  font-weight: 700;
  color: var(--text-primary);
  background: rgba(0, 0, 0, 0.05);
  padding: 3px 8px;
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}
.route-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 10px;
  font-weight: 600;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.02em;
}
.candidate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.candidate-item {
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.8);
  transition: all 0.2s;
}
.candidate-item:hover {
  transform: translateX(2px);
  border-color: rgba(16, 185, 129, 0.3);
}
.candidate-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}
.candidate-right {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.candidate-kind {
  font-size: 9px;
  font-weight: 800;
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.1);
  border-radius: 4px;
  padding: 2px 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.candidate-confidence {
  font-size: 11px;
  font-weight: 800;
  font-family: ui-monospace, monospace;
  color: #059669;
}
.candidate-goal {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.6;
  font-weight: 500;
}
.candidate-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}
.candidate-evidence {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}
.tag {
  font-size: 9px;
  font-weight: 700;
  color: var(--text-secondary);
  background: rgba(0, 0, 0, 0.04);
  border-radius: 6px;
  padding: 2px 8px;
}
.evidence-chip {
  font-size: 9px;
  font-weight: 600;
  color: var(--text-tertiary);
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 6px;
  padding: 2px 8px;
}
.aux-block {
  border-top: 1px solid rgba(236, 239, 242, 0.5);
  padding-top: 12px;
}
.aux-block h4 {
  margin: 0 0 8px;
  font-size: 9px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
.aux-chip-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.aux-chip {
  font-size: 9px;
  font-weight: 600;
  color: var(--text-secondary);
  background: rgba(248, 250, 252, 0.8);
  border: 1px solid rgba(229, 231, 235, 0.8);
  border-radius: 6px;
  padding: 2px 8px;
}
.aux-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.aux-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-secondary);
}
</style>
