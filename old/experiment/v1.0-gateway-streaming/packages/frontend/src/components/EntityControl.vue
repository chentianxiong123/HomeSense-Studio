<script setup lang="ts">
import { ref, computed } from 'vue'
import StateIndicator from './StateIndicator.vue'

const props = defineProps<{
  entity: Record<string, unknown>
  state?: Record<string, unknown>
  onControl: (entityId: string, command: string, value?: unknown) => Promise<void>
}>()

const loading = ref(false)
const localValue = ref<unknown>(undefined)

const domain = computed(() => {
  const d = props.entity.domain
  return typeof d === 'string' ? d : 'switch'
})
const capability = computed(() => {
  const c = props.entity.capability
  return typeof c === 'string' ? c : 'power'
})
const entityId = computed(() => {
  const e = props.entity.entity_id
  return typeof e === 'string' ? e : ''
})
const currentState = computed(() => {
  const s = props.state?.state
  return typeof s === 'string' ? s : 'unknown'
})
const attributes = computed(() => {
  const attrs = props.state?.attributes
  if (attrs && typeof attrs === 'object') return attrs as Record<string, unknown>
  return {}
})

const lastUpdatedStr = computed(() => {
  const v = props.state?.last_updated
  if (v == null) return undefined
  return typeof v === 'string' ? v : String(v as string | number)
})

async function handleControl(command: string, value?: unknown) {
  loading.value = true
  localValue.value = value
  try {
    await props.onControl(entityId.value, command, value)
  } finally {
    loading.value = false
    localValue.value = undefined
  }
}

function isOn(): boolean {
  if (localValue.value !== undefined) return !!localValue.value
  return currentState.value === 'on'
}

function getSliderValue(): number {
  if (localValue.value !== undefined) return Number(localValue.value)
  if (capability.value === 'brightness') return Number(attributes.value.brightness ?? 0)
  if (capability.value === 'color_temperature') return Number(attributes.value.color_temperature ?? 3000)
  if (capability.value === 'target_temperature') return Number(attributes.value.target_temperature ?? 24)
  return 0
}
</script>

<template>
  <div class="entity-control">
    <div class="entity-header">
      <span class="entity-name">{{ entity.name || capability }}</span>
      <StateIndicator :state="currentState" :domain="domain" :last-updated="lastUpdatedStr" />
    </div>

    <div class="entity-body">
      <template v-if="domain === 'switch' || (domain === 'light' && capability === 'power') || (domain === 'climate' && capability === 'power') || (domain === 'fan' && capability === 'power')">
        <label class="switch">
          <input
            type="checkbox"
            :checked="isOn()"
            :disabled="loading"
            @change="handleControl(isOn() ? 'turn_off' : 'turn_on')"
          />
          <span class="slider"></span>
        </label>
      </template>

      <template v-else-if="domain === 'light' && capability === 'brightness'">
        <input
          type="range"
          :min="1"
          :max="100"
          :value="getSliderValue()"
          :disabled="loading"
          class="range-slider"
          @change="handleControl('set_value', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="range-value">{{ getSliderValue() }}%</span>
      </template>

      <template v-else-if="domain === 'light' && capability === 'color_temperature'">
        <input
          type="range"
          :min="2700"
          :max="6500"
          :value="getSliderValue()"
          :disabled="loading"
          class="range-slider"
          @change="handleControl('set_value', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="range-value">{{ getSliderValue() }}K</span>
      </template>

      <template v-else-if="domain === 'climate' && capability === 'target_temperature'">
        <input
          type="range"
          :min="16"
          :max="30"
          :value="getSliderValue()"
          :disabled="loading"
          class="range-slider"
          @change="handleControl('set_value', Number(($event.target as HTMLInputElement).value))"
        />
        <span class="range-value">{{ getSliderValue() }}°C</span>
      </template>

      <template v-else-if="domain === 'sensor'">
        <span class="sensor-value">{{ currentState }}</span>
      </template>

      <template v-else>
        <span class="unknown-value">{{ currentState }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.entity-control {
  padding: 12px 0;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
}

.entity-control:last-child { border-bottom: none; }

.entity-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.entity-name {
  font-size: 15px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.1em;
}

.entity-body {
  display: flex;
  align-items: center;
  gap: 12px;
}

.switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: rgba(226, 232, 240, 0.8);
  transition: .3s;
  border-radius: 24px;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .3s cubic-bezier(0.23, 1, 0.32, 1);
  border-radius: 50%;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
}

input:checked + .slider {
  background-color: var(--primary-color);
}

input:checked + .slider:before {
  transform: translateX(20px);
}

.range-slider {
  flex: 1;
  height: 6px;
  -webkit-appearance: none;
  appearance: none;
  background: rgba(226, 232, 240, 0.8);
  border-radius: 10px;
  outline: none;
}

.range-slider::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #fff;
  border: 2px solid var(--primary-color);
  cursor: pointer;
  box-shadow: 0 2px 4px rgba(0,0,0,0.1);
  transition: all 0.2s;
}

.range-slider::-webkit-slider-thumb:hover { transform: scale(1.1); box-shadow: 0 4px 8px rgba(0,0,0,0.15); }

.range-value {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  min-width: 44px;
  text-align: right;
  font-family: ui-monospace, monospace;
}

.sensor-value {
  font-size: 20px;
  font-weight: 800;
  color: #2563eb;
  letter-spacing: -0.02em;
}

.unknown-value {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

</style>
