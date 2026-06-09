<script setup lang="ts">
import type { MoonlightWebRuntimeStatus, StreamingHost, StreamingHostProbe } from '@/api/streamingGateway'

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
  registered: boolean
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
  label: (zh: string, en: string) => string
}>()

const emit = defineEmits<{
  refreshHosts: []
  refreshRuntime: []
  toggleForm: []
  registerHost: []
  probeHost: [host: StreamingHost]
  wakeHost: [host: StreamingHost]
  removeHost: [host: StreamingHost]
  openRuntime: []
  'update:hostLabel': [value: string]
  'update:hostEndpoint': [value: string]
  'update:hostBasePort': [value: string]
  'update:hostMac': [value: string]
  'update:hostRoom': [value: string]
  'update:hostNetworkPath': [value: string]
}>()
</script>

<template>
  <section class="runtime-panel streaming-gateway-panel">
    <div class="runtime-head">
      <div>
        <span class="eyebrow inline">{{ label('串流网关', 'Streaming Gateway') }}</span>
        <h2>{{ label('Sunshine / Moonlight 管理中心', 'Sunshine / Moonlight Control Center') }}</h2>
      </div>
      <div class="runtime-actions">
        <button class="secondary-btn" @click="emit('refreshHosts')">
          {{ loading ? label('刷新中', 'Refreshing') : label('刷新主机', 'Refresh Hosts') }}
        </button>
        <button class="secondary-btn" @click="emit('refreshRuntime')">
          {{ label('探测播放器', 'Probe Player') }}
        </button>
        <button class="primary-btn" @click="emit('toggleForm')">
          {{ showForm ? label('收起', 'Close') : label('登记 Sunshine 主机', 'Register Sunshine Host') }}
        </button>
      </div>
    </div>
    <p v-if="error" class="error-line">{{ error }}</p>
    <p v-if="message" class="info-line">{{ message }}</p>
    <div v-if="showForm" class="target-form streaming-host-form">
      <label>
        <span>{{ label('名称', 'Label') }}</span>
        <input :value="hostLabel" :placeholder="label('例如 游戏电脑', 'e.g. Gaming PC')" @input="emit('update:hostLabel', ($event.target as HTMLInputElement).value)" />
      </label>
      <label>
        <span>{{ label('主机地址', 'Host') }}</span>
        <input :value="hostEndpoint" placeholder="gaming-pc.local" @input="emit('update:hostEndpoint', ($event.target as HTMLInputElement).value)" />
      </label>
      <label>
        <span>{{ label('基础端口', 'Base Port') }}</span>
        <input :value="hostBasePort" placeholder="47989" @input="emit('update:hostBasePort', ($event.target as HTMLInputElement).value)" />
      </label>
      <label>
        <span>MAC</span>
        <input :value="hostMac" placeholder="AA:BB:CC:DD:EE:FF" @input="emit('update:hostMac', ($event.target as HTMLInputElement).value)" />
      </label>
      <label>
        <span>{{ label('房间', 'Room') }}</span>
        <input :value="hostRoom" :placeholder="label('例如 书房', 'e.g. Study')" @input="emit('update:hostRoom', ($event.target as HTMLInputElement).value)" />
      </label>
      <label>
        <span>{{ label('网络路径', 'Network Path') }}</span>
        <select :value="hostNetworkPath" @change="emit('update:hostNetworkPath', ($event.target as HTMLSelectElement).value)">
          <option value="lan">lan</option>
          <option value="vpn">vpn</option>
          <option value="tunnel">tunnel</option>
          <option value="public">public</option>
        </select>
      </label>
      <button
        class="primary-btn"
        :disabled="actionLoading || !hostLabel.trim() || !hostEndpoint.trim()"
        @click="emit('registerHost')"
      >
        {{ actionLoading ? label('登记中', 'Registering') : label('保存主机', 'Save Host') }}
      </button>
    </div>
    <div v-if="hosts.length > 0" class="streaming-host-grid">
      <article v-for="host in hosts" :key="host.id" class="streaming-host-card">
        <div class="streaming-card-head">
          <div>
            <span>{{ host.network_path }}</span>
            <h3>{{ host.label }}</h3>
          </div>
          <strong>{{ host.status }}</strong>
        </div>
        <code>{{ host.endpoint }}</code>
        <small>{{ host.room || label('未设置房间', 'No room') }} · {{ host.mac_address || label('无 MAC', 'No MAC') }}</small>
        <small>{{ label('端口族', 'Ports') }}: TCP {{ host.tcp_ports.join(', ') }} · UDP {{ host.udp_ports.join(', ') }} · Discovery {{ host.discovery_ports.join(', ') }}</small>
        <div class="target-actions">
          <button class="open-link-btn" :disabled="actionLoading" @click="emit('probeHost', host)">
            {{ label('探测', 'Probe') }}
          </button>
          <button class="open-link-btn" :disabled="actionLoading || !host.mac_address" @click="emit('wakeHost', host)">
            {{ label('唤醒', 'Wake') }}
          </button>
          <button class="open-link-btn danger-inline" :disabled="actionLoading" @click="emit('removeHost', host)">
            {{ label('移除', 'Remove') }}
          </button>
        </div>
        <div v-if="probes[host.id]" class="target-probe">
          <small>
            {{ probes[host.id].reachable ? label('探测通过', 'Probe passed') : label('探测失败', 'Probe failed') }}
          </small>
          <small>{{ probes[host.id].checked_at }}</small>
          <small v-if="probes[host.id].status_code != null">HTTP {{ probes[host.id].status_code }}</small>
          <small v-if="probes[host.id].error">{{ probes[host.id].error }}</small>
          <small v-if="probes[host.id].ports.length > 0">
            {{ label('端口计划', 'Port plan') }}:
            {{ probes[host.id].ports.map((port) => `${port.protocol}/${port.port}:${port.role}`).join(' · ') }}
          </small>
        </div>
      </article>
    </div>
    <div class="streaming-grid">
      <article v-for="item in specs" :key="item.key" class="streaming-card">
        <div class="streaming-card-head">
          <div>
            <span>{{ item.status }}</span>
            <h3>{{ item.title }}</h3>
          </div>
          <strong>{{ item.key }}</strong>
        </div>
        <p>{{ item.subtitle }}</p>
        <small>{{ item.detail }}</small>
        <div class="chip-row">
          <span v-for="capability in item.capabilities" :key="capability" class="cap-chip">
            {{ capability }}
          </span>
        </div>
        <div v-if="item.key === 'web-runtime' && runtimeStatus" class="target-probe">
          <small>{{ runtimeStatus.reachable ? label('运行时可达', 'Runtime reachable') : label('运行时不可达', 'Runtime offline') }}</small>
          <code>{{ runtimeStatus.endpoint }}</code>
          <small v-if="runtimeStatus.status_code != null">HTTP {{ runtimeStatus.status_code }}</small>
          <small v-if="runtimeStatus.error">{{ runtimeStatus.error }}</small>
          <button
            class="open-link-btn"
            :disabled="!runtimeStatus.endpoint.startsWith('http')"
            @click="emit('openRuntime')"
          >
            {{ label('打开播放器', 'Open Player') }}
          </button>
        </div>
      </article>
    </div>
    <p class="info-line">
      {{
        registered
          ? label('串流网关已在外部能力登记处出现，后续可以接 Sunshine/Moonlight 真实适配器。', 'Streaming gateway is registered; Sunshine/Moonlight adapters can be wired later.')
          : label('这里是控制平面入口：HomeSense 负责登记、唤醒、探测和生成连接路径，不重写视频流协议。', 'This is the control-plane entry: HomeSense registers, wakes, probes, and prepares connection paths without rewriting media transport.')
      }}
    </p>
  </section>
</template>

<style scoped>
.runtime-panel {
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  background: #fff;
  box-shadow: 0 8px 22px rgba(15, 23, 42, 0.04);
}

.streaming-gateway-panel {
  padding: 22px;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.runtime-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.runtime-actions,
.target-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.eyebrow {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

.eyebrow.inline {
  display: inline-flex;
  margin-bottom: 5px;
}

h2,
h3,
p {
  margin: 0;
}

h2 {
  color: var(--text-primary, #1e293b);
  font-size: 20px;
  font-weight: 900;
  letter-spacing: 0;
}

h3 {
  color: var(--text-primary, #1e293b);
  font-size: 15px;
  font-weight: 900;
  letter-spacing: 0;
}

.primary-btn,
.secondary-btn,
.open-link-btn {
  min-height: 36px;
  border: 1px solid #d1d5db;
  border-radius: 8px;
  padding: 0 12px;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
  background: #fff;
  color: #334155;
}

.primary-btn {
  border-color: #0f766e;
  background: #0f766e;
  color: #fff;
}

.secondary-btn:hover,
.open-link-btn:hover {
  background: #f8fafc;
}

.primary-btn:disabled,
.secondary-btn:disabled,
.open-link-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.danger-inline {
  border-color: #fecaca;
  color: #b91c1c;
}

.error-line,
.info-line {
  border-radius: 8px;
  padding: 10px 12px;
  font-size: 12px;
  font-weight: 800;
}

.error-line {
  border: 1px solid #fecaca;
  background: #fef2f2;
  color: #b91c1c;
}

.info-line {
  border: 1px solid #ccfbf1;
  background: #f0fdfa;
  color: #0f766e;
}

.target-form {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
  background: #f8fafc;
}

.target-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.target-form span {
  color: #64748b;
  font-size: 11px;
  font-weight: 900;
}

.target-form input,
.target-form select {
  width: 100%;
  min-height: 36px;
  border: 1px solid #cbd5e1;
  border-radius: 8px;
  padding: 0 10px;
  color: #1e293b;
  background: #fff;
}

.streaming-host-grid,
.streaming-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.streaming-host-card,
.streaming-card {
  min-width: 0;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  padding: 14px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.streaming-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.streaming-card-head span,
.streaming-host-card small,
.streaming-card small,
.streaming-card p {
  color: #64748b;
  font-size: 12px;
  line-height: 1.5;
}

.streaming-card-head strong {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 4px 8px;
  background: #fee2e2;
  color: #991b1b;
  font-size: 11px;
  font-weight: 900;
}

code {
  min-width: 0;
  overflow-wrap: anywhere;
  border-radius: 6px;
  padding: 3px 5px;
  background: #eef2f7;
  color: #0f172a;
  font-size: 12px;
}

.target-probe {
  display: flex;
  flex-direction: column;
  gap: 5px;
  border-top: 1px solid #e2e8f0;
  padding-top: 10px;
}

.target-probe small {
  overflow-wrap: anywhere;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cap-chip {
  border-radius: 999px;
  padding: 4px 7px;
  background: #eef2f7;
  color: #475569;
  font-size: 11px;
  font-weight: 900;
}

@media (max-width: 780px) {
  .runtime-head {
    flex-direction: column;
  }

  .target-form {
    grid-template-columns: 1fr;
  }
}
</style>
