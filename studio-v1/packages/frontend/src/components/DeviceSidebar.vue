<script setup lang="ts">
import { useDevices } from '../composables/useDevices'
import { useLocale } from '../composables/useLocale'
import type { DeviceInfo } from '../api'

const { devices, loading, error, discover } = useDevices()
const emit = defineEmits<{ (e: 'select', device: DeviceInfo): void }>()
const { t } = useLocale()

function getConnectionIcon(type: string): string {
  switch (type) {
    case 'wifi': return '📱'
    case 'bt': return '🟦'
    case 'ir': return '📗'
    case 'gateway': return '🕔'
    default: return '📫'
  }
}

function getDomainIcon(domain: string): string {
  switch (domain) {
    case 'switch': return '🎲'
    case 'light': return '💡'
    case 'climate': return '❄️'
    case 'sensor': return '🌅'
    case 'fan': return '🌀'
    case 'cover': return '🪟'
    case 'remote': return '📵'
    case 'xiaoai': return '🔰'
    default: return '⬙'
  }
}
</script>

<template>
  <div class="device-sidebar">
    <div class="sidebar-header">
      <h4>{{ t('device.title') }}</h4>
      <button class="refresh-btn" @click="discover" :disabled="loading">
        {{ loading ? t('device.discovering') : t('device.discover') }}
      </button>
    </div>
    <div v-if="error" class="error-msg">{{ error }}</div>
    <div v-if="!loading && devices.length === 0" class="empty-msg">
      {{ t('device.empty') }}
    </div>
    <div class="device-list">
      <div
        v-for="dev in devices"
        :key="dev.did"
        class="device-item"
        @click="emit('select', dev)"
      >
        <div class="device-icon">
          {{ getConnectionIcon(dev.connection_type) }}
        </div>
        <div class="device-info">
          <div class="device-name">{{ dev.name || dev.model }}</div>
          <div class="device-meta">
            <span class="device-room" v-if="dev.room_name">{{ dev.room_name }}</span>
            <span class="device-model">{{ dev.model }}</span>
          </div>
          <div class="device-entities" v-if="dev.entities?.length">
            <span
              v-for="ent in dev.entities.slice(0, 4)"
              :key="String(ent.entity_id)"
              class="entity-badge"
            >
              {{ getDomainIcon(String(ent.domain || '')) }} {{ ent.capability }}
            </span>
            <span v-if="dev.entities.length > 4" class="entity-more">
              +{{ dev.entities.length - 4 }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.device-sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgba(255, 255, 255, 0.5);
  backdrop-filter: blur(48px);
  border-right: 1px solid rgba(229, 231, 235, 0.4);
  box-shadow: 8px 0 32px rgba(0, 0, 0, 0.03);
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(236, 239, 242, 0.5);
}

.sidebar-header h4 {
  margin: 0;
  font-size: 15px;
  font-weight: 800;
  color: var(--text-tertiary);
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

.refresh-btn {
  padding: 5px 12px;
  background: var(--primary-color);
  color: white;
  border: none;
  border-radius: 8px;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(16, 163, 127, 0.2);
  transition: all 0.2s;
}

.refresh-btn:hover:not(:disabled) {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

.refresh-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.error-msg {
  padding: 10px 20px;
  color: #dc2626;
  font-size: 16px;
  font-weight: 500;
  background: rgba(254, 242, 242, 0.8);
  border-bottom: 1px solid rgba(239, 68, 68, 0.1);
}

.empty-msg {
  padding: 48px 20px;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 15px;
  font-weight: 500;
}

.device-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.device-item {
  display: flex;
  padding: 16px;
  border-radius: 16px;
  margin-bottom: 10px;
  cursor: pointer;
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
  background: rgba(255, 255, 255, 0.45);
  border: 1px solid transparent;
}

.device-item:hover {
  background: rgba(255, 255, 255, 0.9);
  border-color: rgba(16, 185, 129, 0.25);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.04);
  transform: translateX(6px);
}

.device-icon {
  font-size: 20px;
  margin-right: 14px;
  flex-shrink: 0;
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(241, 245, 249, 0.8);
  border-radius: 10px;
  box-shadow: inset 0 1px 2px rgba(0,0,0,0.05);
}

.device-info {
  flex: 1;
  min-width: 0;
}

.device-name {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
}

.device-meta {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-tertiary);
  margin-top: 4px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.device-room {
  margin-right: 8px;
  color: var(--text-secondary);
}

.device-entities {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
}

.entity-badge {
  font-size: 13px;
  font-weight: 700;
  padding: 2px 8px;
  background: rgba(241, 245, 249, 0.8);
  border-radius: 6px;
  color: var(--text-secondary);
  border: 1px solid rgba(229, 231, 235, 0.5);
}

.entity-more {
  font-size: 13px;
  font-weight: 800;
  color: var(--text-tertiary);
  padding: 2px 4px;
}

</style>
