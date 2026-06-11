<script setup lang="ts">
import type { MoonlightWebRuntimeStatus, StreamingHost, StreamingHostProbe } from '@/api/streamingGateway'
import StreamingGatewayPanel from '@/components/remote-workspace/StreamingGatewayPanel.vue'

type LabelFn = (zh: string, en: string) => string

type StreamingGatewaySpec = {
  key: string
  title: string
  subtitle: string
  status: string
  detail: string
  capabilities: string[]
}

defineProps<{
  specs: StreamingGatewaySpec[]
  hosts: StreamingHost[]
  probes: Record<string, StreamingHostProbe>
  runtimeStatus: MoonlightWebRuntimeStatus | null
  hostCount: number
  loading: boolean
  actionLoading: boolean
  error: string
  message: string
  showForm: boolean
  hostLabel: string
  hostEndpoint: string
  hostBasePort: string
  hostMac: string
  hostRoom: string
  hostNetworkPath: string
  label: LabelFn
}>()

const emit = defineEmits<{
  (event: 'open-workbench'): void
  (event: 'refresh-hosts'): void
  (event: 'refresh-runtime'): void
  (event: 'toggle-form'): void
  (event: 'register-host'): void
  (event: 'probe-host', value: StreamingHost): void
  (event: 'wake-host', value: StreamingHost): void
  (event: 'remove-host', value: StreamingHost): void
  (event: 'open-runtime'): void
  (event: 'update:hostLabel', value: string): void
  (event: 'update:hostEndpoint', value: string): void
  (event: 'update:hostBasePort', value: string): void
  (event: 'update:hostMac', value: string): void
  (event: 'update:hostRoom', value: string): void
  (event: 'update:hostNetworkPath', value: string): void
}>()
</script>

<template>
  <section class="detail-surface">
    <div class="detail-head">
      <div>
        <span class="eyebrow">{{ label('局域网账号', 'Local Network') }}</span>
        <h2>{{ label('串流', 'Streaming') }}</h2>
      </div>
      <div class="row-actions">
        <span :class="['pill', hostCount > 0 ? 'ok' : 'muted']">
          {{ hostCount }} {{ label('台主机', 'hosts') }}
        </span>
        <button class="plain-btn compact" type="button" @click="emit('open-workbench')">
          {{ label('打开工作台', 'Open Workbench') }}
        </button>
      </div>
    </div>

    <StreamingGatewayPanel
      :specs="specs"
      :hosts="hosts"
      :probes="probes"
      :runtime-status="runtimeStatus"
      :registered="hostCount > 0"
      :loading="loading"
      :action-loading="actionLoading"
      :error="error"
      :message="message"
      :show-form="showForm"
      :host-label="hostLabel"
      :host-endpoint="hostEndpoint"
      :host-base-port="hostBasePort"
      :host-mac="hostMac"
      :host-room="hostRoom"
      :host-network-path="hostNetworkPath"
      :label="label"
      @refresh-hosts="emit('refresh-hosts')"
      @refresh-runtime="emit('refresh-runtime')"
      @toggle-form="emit('toggle-form')"
      @register-host="emit('register-host')"
      @probe-host="emit('probe-host', $event)"
      @wake-host="emit('wake-host', $event)"
      @remove-host="emit('remove-host', $event)"
      @open-runtime="emit('open-runtime')"
      @update:host-label="emit('update:hostLabel', $event)"
      @update:host-endpoint="emit('update:hostEndpoint', $event)"
      @update:host-base-port="emit('update:hostBasePort', $event)"
      @update:host-mac="emit('update:hostMac', $event)"
      @update:host-room="emit('update:hostRoom', $event)"
      @update:host-network-path="emit('update:hostNetworkPath', $event)"
    />
  </section>
</template>

<style scoped>
.detail-surface {
  min-height: 470px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 22px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
}

.eyebrow {
  display: inline-flex;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0;
}

h2 {
  margin: 5px 0 0;
  color: var(--text-primary);
  font-size: 24px;
  font-weight: 900;
  letter-spacing: 0;
}

.row-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  flex-wrap: wrap;
}

.plain-btn {
  min-height: 34px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 12px;
  background: #fff;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.plain-btn:hover:not(:disabled) {
  border-color: #14b8a6;
  color: #0f766e;
}

.compact {
  min-height: 30px;
  padding: 0 9px;
}

.pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 26px;
  border-radius: 8px;
  padding: 0 9px;
  font-size: 12px;
  font-weight: 900;
  white-space: nowrap;
}

.pill.ok {
  background: #ecfdf5;
  color: #047857;
}

.pill.muted {
  background: #f1f5f9;
  color: #64748b;
}

@media (max-width: 760px) {
  .detail-head {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
