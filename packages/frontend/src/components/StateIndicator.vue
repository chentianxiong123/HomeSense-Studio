<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  state: string
  lastUpdated?: string
  domain?: string
}>()

const stateColor = computed(() => {
  switch (props.state) {
    case 'on':
    case 'online':
    case 'active':
      return '#18a058'
    case 'running':
      return '#2080f0'
    case 'off':
    case 'offline':
    case 'unavailable':
    case 'unknown':
      return '#909399'
    default:
      if (props.domain === 'sensor' || props.domain === 'climate') {
        return '#2080f0'
      }
      return '#909399'
  }
})

const stateText = computed(() => {
  switch (props.state) {
    case 'on': return '已开启'
    case 'off': return '已关闭'
    case 'online': return '在线'
    case 'offline': return '离线'
    case 'unavailable': return '不可用'
    case 'unknown': return '未知'
    default:
      if (props.domain === 'sensor' || props.domain === 'climate') {
        return props.state
      }
      return props.state
  }
})

const isStale = computed(() => {
  if (!props.lastUpdated) return false
  const threshold = 5 * 60 * 1000
  return Date.now() - new Date(props.lastUpdated).getTime() > threshold
})
</script>

<template>
  <span class="state-indicator">
    <span
      class="state-dot"
      :style="{ background: isStale ? '#f0a020' : stateColor }"
    ></span>
    <span class="state-text" :style="{ color: isStale ? '#f0a020' : stateColor }">
      {{ isStale ? '数据过期' : stateText }}
    </span>
  </span>
</template>

<style scoped>
.state-indicator {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.state-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  flex-shrink: 0;
  box-shadow: 0 0 0 2px #fff, 0 0 0 4px rgba(0,0,0,0.05);
}

.state-text {
  font-size: 10px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

</style>
