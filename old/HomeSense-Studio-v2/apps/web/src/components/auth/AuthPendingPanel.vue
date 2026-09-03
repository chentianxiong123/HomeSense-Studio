<script setup lang="ts">
type LabelFn = (zh: string, en: string) => string

defineProps<{
  scope: string
  title: string
  description: string
  label: LabelFn
}>()
</script>

<template>
  <section class="detail-surface">
    <div class="detail-head">
      <div>
        <span class="eyebrow">{{ scope }}</span>
        <h2>{{ title }}</h2>
      </div>
      <span class="pill muted">{{ label('待接入', 'Pending') }}</span>
    </div>
    <div class="empty-line left">{{ description }}</div>
  </section>
</template>

<style scoped>
.detail-surface {
  min-height: 470px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 22px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0;
}

.empty-line {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 18px;
  background: #ffffff;
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.empty-line.left {
  text-align: left;
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  border-radius: 8px;
  padding: 0 9px;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
}

.pill.muted {
  background: #f1f5f9;
  color: #64748b;
}

@media (max-width: 760px) {
  .detail-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
