<script setup lang="ts">
type AssetDomainKey = 'runtime_capability' | 'device_skill' | 'memory' | 'skill' | 'mcp_skill' | 'gateway'

type AssetDomain = {
  key: AssetDomainKey
  title: string
  subtitle: string
  status: string
  count: number | null
  accent: string
}

defineProps<{
  domains: AssetDomain[]
  selectedKey: AssetDomainKey
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  select: [key: AssetDomainKey]
}>()
</script>

<template>
  <section class="domain-grid">
    <button
      v-for="domain in domains"
      :key="domain.key"
      type="button"
      :class="['domain-card', { active: selectedKey === domain.key, planned: domain.count === null }]"
      :style="{ '--accent': domain.accent }"
      @click="emit('select', domain.key)"
    >
      <span class="domain-status">{{ domain.status }}</span>
      <strong>{{ domain.title }}</strong>
      <small>{{ domain.subtitle }}</small>
      <span class="domain-count">{{ domain.count === null ? label('待接入', 'Pending') : domain.count }}</span>
    </button>
  </section>
</template>

<style scoped>
.domain-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
  margin-top: 20px;
}

.domain-card {
  min-height: 176px;
  padding: 18px;
  border: 1px solid rgba(203, 213, 225, 0.75);
  border-radius: 8px;
  background: #ffffff;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.domain-card:hover,
.domain-card.active {
  transform: translateY(-3px);
  border-color: var(--accent);
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
}

.domain-card.planned {
  background: rgba(255, 255, 255, 0.62);
}

.domain-status {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 900;
}

.domain-card strong {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 900;
  line-height: 1.25;
}

.domain-card small {
  flex: 1;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 750;
  line-height: 1.5;
}

.domain-count {
  color: var(--accent);
  font-size: 22px;
  font-weight: 950;
}

@media (max-width: 1280px) {
  .domain-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .domain-grid {
    grid-template-columns: 1fr;
  }
}
</style>
