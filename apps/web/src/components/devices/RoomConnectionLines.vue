<script setup lang="ts">
export type RoomConnectionLine = {
  id: string
  x1: number
  y1: number
  x2: number
  y2: number
}

defineProps<{
  lines: RoomConnectionLine[]
}>()
</script>

<template>
  <svg class="room-connections-svg">
    <line
      v-for="line in lines"
      :key="line.id"
      :x1="line.x1"
      :y1="line.y1"
      :x2="line.x2"
      :y2="line.y2"
      class="connection-line"
    />
  </svg>
</template>

<style scoped>
.room-connections-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.connection-line {
  stroke: rgba(99, 102, 241, 0.35);
  stroke-width: 2.5;
  stroke-dasharray: 6, 4;
  animation: group-flow 2s linear infinite;
}

@keyframes group-flow {
  from { stroke-dashoffset: 20; }
  to { stroke-dashoffset: 0; }
}
</style>
