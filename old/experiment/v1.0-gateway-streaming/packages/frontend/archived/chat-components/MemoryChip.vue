<script setup lang="ts">
import type { MemoryHit } from '../../types/chat'
import { useLocale } from '../../composables/useLocale'

defineProps<{ hits: MemoryHit[] }>()
const { t } = useLocale()
</script>

<template>
  <div v-if="hits.length > 0" class="memory-chips">
    <span class="memory-chip-label">{{ t('memory.label') }}</span>
    <span v-for="hit in hits" :key="hit.id" class="memory-chip" :title="hit.snippet ?? ''">
      <span class="memory-chip-type">{{ hit.type }}</span>
      <span class="memory-chip-name">{{ hit.name }}</span>
    </span>
  </div>
</template>

<style scoped>
.memory-chips {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 0;
}
.memory-chip-label {
  font-size: 9px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-right: 4px;
}
.memory-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 99px;
  background: rgba(124, 58, 237, 0.08);
  backdrop-filter: blur(8px);
  color: #6d28d9;
  font-size: 11px;
  border: 1px solid rgba(124, 58, 237, 0.15);
  transition: all 0.2s ease;
  cursor: default;
}
.memory-chip:hover {
  background: rgba(124, 58, 237, 0.12);
  transform: translateY(-1px);
}
.memory-chip-type {
  font-size: 8px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #7c3aed;
  opacity: 0.8;
}
.memory-chip-name { font-weight: 700; overflow-wrap: anywhere; }
</style>
