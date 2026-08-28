<script setup lang="ts">
type WorkspacePanelKey = 'overview' | 'terminal' | 'files' | 'network' | 'streaming' | 'remote'

defineProps<{
  panels: Array<{ key: WorkspacePanelKey; label: string; short: string }>
  activePanel: WorkspacePanelKey
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  'update:activePanel': [value: WorkspacePanelKey]
}>()
</script>

<template>
  <nav class="workspace-tabs" :aria-label="label('工作区模块', 'Workspace modules')">
    <button
      v-for="panel in panels"
      :key="panel.key"
      :class="['workspace-tab', { active: activePanel === panel.key }]"
      @click="emit('update:activePanel', panel.key)"
    >
      <span>{{ panel.short }}</span>
      <strong>{{ panel.label }}</strong>
    </button>
  </nav>
</template>
