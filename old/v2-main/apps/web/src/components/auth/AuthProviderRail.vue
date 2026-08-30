<script setup lang="ts" generic="T extends string">
export type AuthProviderTone = 'ok' | 'warn' | 'bad' | 'muted'

export type AuthProviderItem<T extends string = string> = {
  id: T
  name: string
  subtitle: string
  status: string
  tone: AuthProviderTone
  meta: string
}

defineProps<{
  providers: AuthProviderItem<T>[]
  selected: T
}>()

const emit = defineEmits<{
  (event: 'select', value: T): void
}>()
</script>

<template>
  <aside class="provider-rail">
    <button
      v-for="provider in providers"
      :key="provider.id"
      :class="['provider-item', { active: selected === provider.id }]"
      @click="emit('select', provider.id)"
    >
      <span :class="['dot', provider.tone]" />
      <strong>{{ provider.name }}</strong>
      <small>{{ provider.subtitle }}</small>
      <em>{{ provider.status }} · {{ provider.meta }}</em>
    </button>
  </aside>
</template>

<style scoped>
.provider-rail {
  display: grid;
  gap: 8px;
}

.provider-item {
  min-height: 86px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 13px 14px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  cursor: pointer;
  text-align: left;
  display: grid;
  grid-template-columns: auto 1fr;
  column-gap: 9px;
  row-gap: 4px;
}

.provider-item strong,
.provider-item small,
.provider-item em {
  grid-column: 2;
}

.provider-item strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0;
}

.provider-item small,
.provider-item em {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.provider-item em {
  font-style: normal;
}

.provider-item.active {
  border-color: #14b8a6;
  background: #f0fdfa;
}

.dot {
  width: 9px;
  height: 9px;
  margin-top: 5px;
  border-radius: 999px;
  background: #94a3b8;
}

.dot.ok {
  background: #10b981;
}

.dot.warn {
  background: #f59e0b;
}

.dot.bad {
  background: #ef4444;
}

@media (max-width: 1240px) {
  .provider-rail {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .provider-rail {
    grid-template-columns: 1fr;
  }
}
</style>
