<script setup lang="ts">
defineProps<{
  icon: string
}>()
</script>

<template>
  <div class="node-icon" :class="`icon-${icon}`">
    <svg v-if="icon === 'tv'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
      <line x1="8" y1="21" x2="16" y2="21"></line>
      <line x1="12" y1="17" x2="12" y2="21"></line>
    </svg>
    <svg v-else-if="icon === 'speaker'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
      <rect x="4" y="2" width="16" height="20" rx="3"></rect>
      <circle cx="12" cy="14" r="3"></circle>
      <line x1="12" y1="7" x2="12" y2="9"></line>
    </svg>
    <svg v-else-if="icon === 'phone'" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
      <rect x="5" y="2" width="14" height="20" rx="3"></rect>
      <line x1="12" y1="18" x2="12.01" y2="18"></line>
    </svg>
    <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5">
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
      <line x1="8" y1="21" x2="16" y2="21"></line>
      <line x1="12" y1="17" x2="12" y2="21"></line>
    </svg>
  </div>
</template>

<style scoped>
.node-icon {
  width: 34px;
  height: 34px;
  border-radius: 14px;
  background: rgba(16, 185, 129, 0.1);
  color: #10b981;
  display: flex;
  align-items: center;
  justify-content: center;
}

.node-icon.icon-speaker {
  background: rgba(99, 102, 241, 0.1);
  color: #6366f1;
}

.node-icon.icon-phone {
  background: rgba(245, 158, 11, 0.12);
  color: #d97706;
}
</style>
