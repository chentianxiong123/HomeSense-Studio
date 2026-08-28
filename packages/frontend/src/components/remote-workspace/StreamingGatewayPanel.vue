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
