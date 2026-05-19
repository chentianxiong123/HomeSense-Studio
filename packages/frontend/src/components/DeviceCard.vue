<script setup lang="ts">
import { computed } from 'vue'
import StateIndicator from './StateIndicator.vue'
import EntityControl from './EntityControl.vue'

const props = defineProps<{
  device: Record<string, unknown>
  entities: Array<Record<string, unknown>>
  states: Record<string, Record<string, unknown>>
  onControl: (entityId: string, command: string, value?: unknown) => Promise<void>
}>()

const deviceIcon = computed(() => {
  const type = props.device.device_type || props.device.connection_type
  const icons: Record<string, string> = {
    light: '💡', ceiling_light: '💡', desk_lamp: '💡', lamp: '💡',
    switch: '🔌', outlet: '🔌',
    air_conditioner: '❄️', air_condition_outlet: '❄️', heater: '🔥', climate: '❄️',
    fan: '🌀', ceiling_fan: '🌀',
    curtain: '🪟', cover: '🪟',
    sensor: '🌡️', temperature_humidity_sensor: '🌡️', air_monitor: '🌬️', air_purifier: '🌬️',
    remote: '📺',
    intelligent_speaker: '🔊', xiaoai: '🔊',
    wifi: '📶', bt: '🔵', ir: '📡', gateway: '🏠',
  }
  for (const [key, icon] of Object.entries(icons)) {
    if (String(type).toLowerCase().includes(key)) return icon
  }
  return '📱'
})

const statusText = computed(() => {
  const entities = props.entities
  if (!entities.length) return '无实体'

  const onEntities = entities.filter(e => {
    const state = props.states[String(e.entity_id)]?.state
    return state === 'on'
  })
  const offEntities = entities.filter(e => {
    const state = props.states[String(e.entity_id)]?.state
    return state === 'off'
  })

  if (onEntities.length > 0) return `${onEntities.length} 个开启`
  if (offEntities.length === entities.length) return '全部关闭'
  return `${entities.length} 个实体`
})
</script>

<template>
  <div class="device-card">
    <div class="card-header">
      <span class="device-icon">{{ deviceIcon }}</span>
      <div class="card-title">
        <h4>{{ device.name || device.model }}</h4>
        <span class="card-meta">
          <StateIndicator :state="entities.length > 0 ? 'online' : 'offline'" />
          <span class="status-text">{{ statusText }}</span>
        </span>
      </div>
    </div>
    <div class="card-body">
      <EntityControl
        v-for="entity in entities"
        :key="String(entity.entity_id)"
        :entity="entity"
        :state="states[String(entity.entity_id)]"
        :on-control="onControl"
      />
    </div>
  </div>
</template>

<style scoped>
.device-card {
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(32px);
  border: 1px solid rgba(229, 231, 235, 0.5);
  border-radius: 24px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.03);
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.device-card:hover { transform: translateY(-6px); box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08); background: rgba(255, 255, 255, 0.9); border-color: rgba(16, 185, 129, 0.25); }

.card-header {
  display: flex;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
}

.device-icon {
  font-size: 24px;
  margin-right: 16px;
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(241, 245, 249, 0.8);
  border-radius: 12px;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
}

.card-title h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-primary);
  letter-spacing: -0.01em;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 4px;
}

.status-text {
  font-size: 10px;
  font-weight: 700;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.card-body {
  padding: 12px 20px 20px;
}

</style>
