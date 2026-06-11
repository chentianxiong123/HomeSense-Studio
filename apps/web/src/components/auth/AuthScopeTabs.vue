<script setup lang="ts">
type AuthTab = 'external' | 'local'
type LabelFn = (zh: string, en: string) => string

defineProps<{
  activeTab: AuthTab
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'update:activeTab', value: AuthTab): void
}>()
</script>

<template>
  <nav class="scope-tabs" :aria-label="label('授权分类', 'Authorization scope')">
    <button :class="['scope-tab', { active: activeTab === 'external' }]" @click="emit('update:activeTab', 'external')">
      <strong>{{ label('外部账号', 'External Accounts') }}</strong>
      <span>Mi / Bilibili</span>
    </button>
    <button :class="['scope-tab', { active: activeTab === 'local' }]" @click="emit('update:activeTab', 'local')">
      <strong>{{ label('局域网账号', 'Local Network') }}</strong>
      <span>ADB / DLNA / {{ label('串流', 'Streaming') }} / AList / SSH / FRP / SMB</span>
    </button>
  </nav>
</template>

<style scoped>
.scope-tabs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.scope-tab {
  min-height: 72px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px 16px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  cursor: pointer;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.scope-tab strong {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0;
}

.scope-tab span {
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.45;
}

.scope-tab.active {
  border-color: #14b8a6;
  background: #f0fdfa;
}

@media (max-width: 760px) {
  .scope-tabs {
    grid-template-columns: 1fr;
  }
}
</style>
