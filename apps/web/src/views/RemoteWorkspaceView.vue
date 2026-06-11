<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import '@/components/remote-workspace/remoteWorkspace.css'
import { useRouter } from 'vue-router'
import { externalIntegrationApi, type ExternalIntegrationRecord } from '@/api/externalIntegrations'
import LaneGrid from '@/components/remote-workspace/LaneGrid.vue'
import LocalTerminalPanel from '@/components/remote-workspace/LocalTerminalPanel.vue'
import LocalFilesystemPanel from '@/components/remote-workspace/LocalFilesystemPanel.vue'
import NetworkAccessPanel from '@/components/remote-workspace/NetworkAccessPanel.vue'
import OptionalWorkspaceViewport from '@/components/remote-workspace/OptionalWorkspaceViewport.vue'
import RemoteHostsPanel from '@/components/remote-workspace/RemoteHostsPanel.vue'
import RuntimeStatusPanel from '@/components/remote-workspace/RuntimeStatusPanel.vue'
import StreamingGatewayPanel from '@/components/remote-workspace/StreamingGatewayPanel.vue'
import WorkspaceHeader from '@/components/remote-workspace/WorkspaceHeader.vue'
import WorkspaceModuleTabs from '@/components/remote-workspace/WorkspaceModuleTabs.vue'
import WorkspaceSummaryStrip from '@/components/remote-workspace/WorkspaceSummaryStrip.vue'
import {
  remoteWorkspaceApi,
  type RemoteWorkspaceFileEntry,
  type RemoteWorkspaceFileList,
  type RemoteWorkspaceFilePreview,
  type RemoteWorkspaceStatus,
  type RemoteWorkspaceTarget,
  type RemoteWorkspaceTargetProbe,
} from '@/api/remoteWorkspace'
import { streamingGatewayApi, type StreamingHost, type StreamingHostProbe } from '@/api/streamingGateway'
import { useLocale } from '@/composables/useLocale'

type LaneSpec = {
  key: string
  integrationName: string
  title: string
  subtitle: string
  role: string
  marker: string
  accent: string
  references: string[]
  fallbackCapabilities: string[]
  primary?: boolean
}

type NetworkAccessSpec = {
  key: string
  title: string
  subtitle: string
  status: string
  endpoint: string
  capabilities: string[]
}

type StreamingGatewaySpec = {
  key: string
  title: string
  subtitle: string
  status: string
  detail: string
  capabilities: string[]
}

type WorkspacePanelKey = 'overview' | 'terminal' | 'files' | 'network' | 'streaming' | 'remote'

const router = useRouter()
const { locale } = useLocale()
const integrations = ref<ExternalIntegrationRecord[]>([])
const workspaceStatus = ref<RemoteWorkspaceStatus | null>(null)
const workspaceTargets = ref<RemoteWorkspaceTarget[]>([])
const workspaceTargetProbes = ref<Record<string, RemoteWorkspaceTargetProbe>>({})
const loading = ref(false)
const workspaceLoading = ref(false)
const workspaceActionLoading = ref(false)
const targetActionLoading = ref(false)
const errorMessage = ref('')
const workspaceError = ref('')
const workspaceActionMessage = ref('')
const targetError = ref('')
const targetMessage = ref('')
const showTargetForm = ref(false)
const targetLabel = ref('')
const targetEndpoint = ref('')
const targetRoot = ref('')
const targetAuthMode = ref('ssh_key_or_agent')
const filesystemTargetId = ref('local:source')
const filesystemPath = ref('')
const filesystemList = ref<RemoteWorkspaceFileList | null>(null)
const filesystemPreview = ref<RemoteWorkspaceFilePreview | null>(null)
const filesystemLoading = ref(false)
const filesystemError = ref('')
const streamingHosts = ref<StreamingHost[]>([])
const streamingHostProbes = ref<Record<string, StreamingHostProbe>>({})
const streamingRuntimeStatus = ref<{
  name: string
  endpoint: string
  enabled: boolean
  registered: boolean
  reachable: boolean
  status_code: number | null
  checked_at: string
  error?: string
  notes: string[]
} | null>(null)
const streamingLoading = ref(false)
const streamingActionLoading = ref(false)
const streamingError = ref('')
const streamingMessage = ref('')
const showStreamingHostForm = ref(false)
const streamingHostLabel = ref('')
const streamingHostEndpoint = ref('')
const streamingHostBasePort = ref('47989')
const streamingHostMac = ref('')
const streamingHostRoom = ref('')
const streamingHostNetworkPath = ref('lan')
const activePanel = ref<WorkspacePanelKey>('overview')

const isZh = computed(() => locale.value === 'zh')

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const workspacePanels = computed<Array<{ key: WorkspacePanelKey; label: string; short: string }>>(() => [
  { key: 'overview', label: label('总览', 'Overview'), short: label('总览', 'Home') },
  { key: 'terminal', label: label('本机终端', 'Terminal'), short: label('终端', 'TTY') },
  { key: 'files', label: label('文件系统', 'Files'), short: label('文件', 'Files') },
  { key: 'network', label: label('网络入口', 'Network'), short: label('网络', 'Net') },
  { key: 'streaming', label: label('串流网关', 'Streaming'), short: label('串流', 'Stream') },
  { key: 'remote', label: label('远程扩展', 'Remote'), short: label('远程', 'SSH') },
])

const laneSpecs = computed<LaneSpec[]>(() => [
  {
    key: 'code-server',
    integrationName: 'code-server-workspace',
    title: label('code-server 工作台', 'code-server Workspace'),
    subtitle: label('可选的浏览器编辑器内核', 'Optional browser editor core'),
    role: label(
      '作为可选的浏览器编辑器内核，直接复用文件树、编辑器和集成终端；HomeSense 只负责登记、打开和编排。',
      'Optional browser editor core: reuse its file tree, editor, and integrated terminal while HomeSense only registers, opens, and orchestrates it.',
    ),
    marker: 'CS',
    accent: '#0f766e',
    references: ['coder/code-server', 'VS Code Web', 'reverse proxy auth'],
    fallbackCapabilities: [
      'workspace.code_server.status',
      'workspace.code_server.start',
      'workspace.code_server.stop',
      'workspace.code_server.open',
      'workspace.code_server.open_folder',
      'workspace.code_server.open_terminal',
      'filesystem.tree',
      'terminal.session.open',
    ],
  },
  {
    key: 'terminal',
    integrationName: 'terminal-ssh-gateway',
    title: label('SSH 终端', 'SSH Terminal'),
    subtitle: label('浏览器可见的远程命令行', 'Browser-visible remote shell'),
    role: label(
      '负责打开本机或远程主机终端，把输入、输出和窗口尺寸走 WebSocket 流。',
      'Opens local or remote host terminals and streams input, output, and resize events over WebSocket.',
    ),
    marker: 'TTY',
    accent: '#0f766e',
    references: ['xterm.js', 'ttyd', 'Wetty', 'Sshwifty'],
    fallbackCapabilities: [
      'terminal.session.open',
      'terminal.session.input',
      'terminal.session.resize',
      'terminal.session.close',
      'terminal.ssh.connect',
    ],
    primary: true,
  },
  {
    key: 'filesystem',
    integrationName: 'filesystem-gateway',
    title: label('文件系统', 'Filesystem'),
    subtitle: label('远程目录、预览和搜索', 'Remote tree, preview, and search'),
    role: label(
      '负责呈现远程主机目录树、文件预览和内容搜索，后续可以接 SFTP 或挂载服务。',
      'Presents remote host trees, previews, and content search through SFTP or mount services.',
    ),
    marker: 'FS',
    accent: '#2563eb',
    references: ['FileBrowser', 'SFTPGo'],
    fallbackCapabilities: [
      'filesystem.tree',
      'filesystem.read',
      'filesystem.search',
      'filesystem.preview',
      'filesystem.mount',
    ],
  },
  {
    key: 'streaming-gateway',
    integrationName: 'streaming-gateway',
    title: label('串流网关', 'Streaming Gateway'),
    subtitle: label('Sunshine / Moonlight 控制平面', 'Sunshine / Moonlight control plane'),
    role: label(
      '统一登记 Sunshine 主机、Moonlight 客户端、唤醒、配对、网络路径和串流档位；视频流本身仍由 Moonlight/Sunshine 承担。',
      'Registers Sunshine hosts, Moonlight clients, wake, pairing, network paths, and stream profiles; media transport remains owned by Moonlight/Sunshine.',
    ),
    marker: 'STM',
    accent: '#dc2626',
    references: ['Sunshine', 'Moonlight', 'Wake-on-LAN', 'VPN', 'UDP path'],
    fallbackCapabilities: [
      'streaming.host.sunshine',
      'streaming.client.moonlight',
      'streaming.session.launch',
      'streaming.wake_on_lan',
      'streaming.network_path.check',
    ],
  },
  {
    key: 'network-access',
    integrationName: 'network-access-gateway',
    title: label('网络入口', 'Network Access'),
    subtitle: label('公网访问、内网穿透和反向代理', 'Public access, tunneling, and reverse proxy'),
    role: label(
      '登记 NAS 工作区如何被手机、外网、局域网或其他家庭节点访问；具体实现可接 frp、Tailscale、Cloudflare Tunnel、rathole 或反向代理。',
      'Registers how the NAS workspace is reached from mobile, public internet, LAN, or other home nodes; adapters can later connect frp, Tailscale, Cloudflare Tunnel, rathole, or reverse proxy.',
    ),
    marker: 'NET',
    accent: '#0891b2',
    references: ['frp', 'Tailscale', 'Cloudflare Tunnel', 'rathole', 'reverse proxy'],
    fallbackCapabilities: [
      'network.access.lan',
      'network.access.public_url',
      'network.tunnel.status',
      'network.proxy.route',
      'network.ssh.entrypoint',
    ],
  },
  {
    key: 'gateway',
    integrationName: 'message-gateway',
    title: label('消息网关', 'Message Gateway'),
    subtitle: label('未来接家庭中枢消息通道', 'Future home-hub message channels'),
    role: label(
      '借鉴 Hermes 的网关结构，用适配器管理不同外部消息通道，和终端工作台保持同级。',
      'Uses a Hermes-style gateway adapter shape for external message channels at the same level as the terminal workspace.',
    ),
    marker: 'GW',
    accent: '#7c3aed',
    references: ['Hermes gateway'],
    fallbackCapabilities: [
      'message.gateway.receive',
      'message.gateway.send',
      'message.gateway.mirror',
      'message.gateway.status',
    ],
  },
])

const integrationByName = computed(() => {
  const map = new Map<string, ExternalIntegrationRecord>()
  for (const item of integrations.value) {
    map.set(item.name, item)
  }
  return map
})

const lanes = computed(() =>
  laneSpecs.value.map((spec) => ({
    ...spec,
    integration: integrationByName.value.get(spec.integrationName),
  })),
)

const registeredLaneCount = computed(() => lanes.value.filter((lane) => lane.integration).length)
const readyTargetCount = computed(() => workspaceTargets.value.filter((target) => target.status === 'ready').length)
const readySshTargetCount = computed(() => workspaceTargets.value.filter((target) => target.kind === 'ssh_host' && target.status === 'ready').length)
const networkAccessIntegration = computed(() => integrationByName.value.get('network-access-gateway'))
const networkAccessSpecs = computed<NetworkAccessSpec[]>(() => {
  const localEndpoint = typeof window !== 'undefined' ? window.location.origin : ''
  return [
    {
      key: 'lan',
      title: label('局域网入口', 'LAN Entry'),
      subtitle: label('手机和家里设备优先走内网地址。', 'Phones and home devices should prefer the LAN address.'),
      status: label('主路径', 'Primary'),
      endpoint: localEndpoint,
      capabilities: ['network.access.lan', 'workspace.open.local'],
    },
    {
      key: 'reverse-proxy',
      title: label('反向代理', 'Reverse Proxy'),
      subtitle: label('把 NAS 服务整理成统一域名和 HTTPS 入口。', 'Expose NAS services behind a unified domain and HTTPS entry.'),
      status: label('待接入', 'Pending'),
      endpoint: label('等待登记 Nginx / Caddy / Traefik', 'Waiting for Nginx / Caddy / Traefik'),
      capabilities: ['network.proxy.route', 'network.tls.terminate'],
    },
    {
      key: 'tunnel',
      title: label('内网穿透', 'Tunneling'),
      subtitle: label('外网临时或长期访问 NAS 工作台。', 'Temporary or long-lived public access to the NAS workspace.'),
      status: label('待接入', 'Pending'),
      endpoint: label('等待登记 frp / Tailscale / Cloudflare Tunnel', 'Waiting for frp / Tailscale / Cloudflare Tunnel'),
      capabilities: ['network.tunnel.status', 'network.access.public_url'],
    },
    {
      key: 'ssh-entry',
      title: label('SSH 入口', 'SSH Entry'),
      subtitle: label('运维通道，和 Chat 解耦，给工作区和工作流复用。', 'Ops channel decoupled from Chat, reusable by workspace and workflows.'),
      status: readySshTargetCount.value > 0 ? label('已有目标', 'Targets Ready') : label('待登记', 'Pending'),
      endpoint: `${readySshTargetCount.value}/${workspaceTargets.value.length}`,
      capabilities: ['terminal.ssh.connect', 'terminal.session.open'],
    },
  ]
})
const streamingGatewayIntegration = computed(() => integrationByName.value.get('streaming-gateway'))
const moonlightWebRuntimeIntegration = computed(() => integrationByName.value.get('moonlight-web-runtime'))
const registeredStreamingHostCount = computed(() => streamingHosts.value.length)
const streamingGatewaySpecs = computed<StreamingGatewaySpec[]>(() => [
  {
    key: 'sunshine-hosts',
    title: label('Sunshine 主机', 'Sunshine Hosts'),
    subtitle: label('登记家里的高性能电脑、工作站或游戏主机。', 'Register gaming PCs, workstations, or high-performance hosts at home.'),
    status: registeredStreamingHostCount.value > 0 ? label('已有主机', 'Hosts Ready') : label('待登记', 'Pending'),
    detail: label('需要主机地址、MAC、Sunshine 服务状态和可用应用。', 'Needs host address, MAC, Sunshine service status, and available applications.'),
    capabilities: ['streaming.host.sunshine', 'device.wake_on_lan', 'service.status.probe'],
  },
  {
    key: 'moonlight-clients',
    title: label('Moonlight 客户端', 'Moonlight Clients'),
    subtitle: label('登记手机、电视、平板或掌机作为接收端。', 'Register phones, TVs, tablets, or handhelds as stream clients.'),
    status: label('待登记', 'Pending'),
    detail: label('客户端可以只保存类型和启动入口，不需要 HomeSense 承载视频。', 'Clients can store type and launch entry; HomeSense does not carry the video stream.'),
    capabilities: ['streaming.client.moonlight', 'streaming.client.launch'],
  },
  {
    key: 'network-path',
    title: label('串流网络路径', 'Streaming Network Path'),
    subtitle: label('区分 LAN、VPN、穿透、公网直连，不混成一个按钮。', 'Separate LAN, VPN, tunnel, and public direct paths instead of one opaque button.'),
    status: label('规划中', 'Planned'),
    detail: label('低延迟串流优先考虑 LAN/VPN，穿透只作为可选路径。', 'Low-latency streaming should prefer LAN/VPN; tunneling is an optional path.'),
    capabilities: ['streaming.network_path.check', 'network.access.lan', 'network.tunnel.status'],
  },
  {
    key: 'web-runtime',
    title: label('Web 播放器运行时', 'Web Player Runtime'),
    subtitle: label('把 Moonlight/GameStream 转成浏览器可播放入口。', 'Bridge Moonlight/GameStream into a browser-playable entry.'),
    status: moonlightWebRuntimeIntegration.value ? label('已登记', 'Registered') : label('预留', 'Reserved'),
    detail: label('后续接 moonlight-web-runtime / WebRTC 桥；HomeSense 负责打开和管理，不在主后端承载视频内核。', 'Later wire moonlight-web-runtime / WebRTC bridge; HomeSense opens and manages it without carrying the media core in the main backend.'),
    capabilities: ['streaming.web_player.open', 'streaming.runtime.probe', 'streaming.webrtc.bridge'],
  },
  {
    key: 'profiles',
    title: label('串流档位', 'Stream Profiles'),
    subtitle: label('保存 1080p60、1440p60、4K60、码率和输入模式。', 'Store 1080p60, 1440p60, 4K60, bitrate, and input mode profiles.'),
    status: label('预留', 'Reserved'),
    detail: label('后续由设备能力、网络质量和客户端类型选择默认档位。', 'Later choose defaults from device capability, network quality, and client type.'),
    capabilities: ['streaming.profile.select', 'streaming.bitrate.set', 'streaming.resolution.set'],
  },
])
const terminalTargets = computed(() => [
  { id: 'local:shell', label: label('本地 Shell', 'Local Shell') },
  ...workspaceTargets.value
    .filter((target) => target.kind === 'ssh_host')
    .map((target) => ({ id: target.id, label: target.label })),
])
const workspaceOpenUrl = computed(() => {
  const endpoint = optionalText(workspaceStatus.value?.integration?.endpoint)
  if (endpoint.startsWith('http://') || endpoint.startsWith('https://')) return endpoint
  const healthUrl = optionalText(workspaceStatus.value?.endpoint.url)
  try {
    const url = new URL(healthUrl)
    url.pathname = '/'
    url.search = ''
    url.hash = ''
    return url.toString().replace(/\/$/, '')
  } catch {
    return ''
  }
})
const canShowWorkspaceFrame = computed(() => Boolean(workspaceOpenUrl.value && workspaceStatus.value?.endpoint.reachable))
const filesystemTargets = computed(() => [
  { id: 'local:source', label: label('本机源码', 'Local Source') },
  { id: 'sidecar:code-server', label: label('侧车工作区', 'Sidecar Workspace') },
])
const filesystemParentPath = computed(() => {
  const parts = filesystemPath.value.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
})

async function loadIntegrations() {
  loading.value = true
  errorMessage.value = ''
  try {
    const res = await externalIntegrationApi.list()
    integrations.value = res.integrations ?? []
  } catch {
    errorMessage.value = label('无法读取外部能力登记。', 'Failed to load external capability registry.')
  } finally {
    loading.value = false
  }
}

async function loadWorkspaceStatus() {
  workspaceLoading.value = true
  workspaceError.value = ''
  try {
    const res = await remoteWorkspaceApi.status()
    workspaceStatus.value = res.data ?? null
  } catch {
    workspaceError.value = label('无法探测 code-server 工作台。', 'Failed to probe the code-server workspace.')
  } finally {
    workspaceLoading.value = false
  }
}

async function loadWorkspaceTargets() {
  targetError.value = ''
  try {
    const res = await remoteWorkspaceApi.targets()
    workspaceTargets.value = res.data ?? []
  } catch {
    targetError.value = label('无法读取工作区目标。', 'Failed to load workspace targets.')
  }
}

async function loadStreamingHosts() {
  streamingLoading.value = true
  streamingError.value = ''
  try {
    const res = await streamingGatewayApi.hosts()
    streamingHosts.value = res.data ?? []
  } catch {
    streamingError.value = label('无法读取串流主机。', 'Failed to load streaming hosts.')
  } finally {
    streamingLoading.value = false
  }
}

async function loadStreamingRuntimeStatus() {
  try {
    const res = await streamingGatewayApi.runtimeStatus()
    streamingRuntimeStatus.value = res.data ?? null
  } catch {
    streamingRuntimeStatus.value = null
  }
}

async function registerStreamingHost() {
  if (!streamingHostLabel.value.trim() || !streamingHostEndpoint.value.trim()) return
  streamingActionLoading.value = true
  streamingError.value = ''
  streamingMessage.value = ''
  try {
    await streamingGatewayApi.registerHost({
      label: streamingHostLabel.value.trim(),
      endpoint: streamingHostEndpoint.value.trim(),
      base_port: streamingHostBasePort.value.trim(),
      mac_address: streamingHostMac.value.trim(),
      room: streamingHostRoom.value.trim(),
      network_path: streamingHostNetworkPath.value,
    })
    streamingHostLabel.value = ''
    streamingHostEndpoint.value = ''
    streamingHostBasePort.value = '47989'
    streamingHostMac.value = ''
    streamingHostRoom.value = ''
    streamingHostNetworkPath.value = 'lan'
    showStreamingHostForm.value = false
    streamingMessage.value = label('Sunshine 主机已登记。', 'Sunshine host registered.')
    await loadStreamingHosts()
    await loadIntegrations()
  } catch {
    streamingError.value = label('登记 Sunshine 主机失败。', 'Failed to register Sunshine host.')
  } finally {
    streamingActionLoading.value = false
  }
}

async function probeStreamingHost(host: StreamingHost) {
  streamingActionLoading.value = true
  streamingError.value = ''
  streamingMessage.value = ''
  try {
    const res = await streamingGatewayApi.probeHost(host.id)
    streamingHostProbes.value = {
      ...streamingHostProbes.value,
      [host.id]: res.data,
    }
    streamingMessage.value = res.data.reachable
      ? label('Sunshine 主机探测通过。', 'Sunshine host probe passed.')
      : label('Sunshine 主机不可达。', 'Sunshine host is not reachable.')
  } catch {
    streamingError.value = label('探测 Sunshine 主机失败。', 'Failed to probe Sunshine host.')
  } finally {
    streamingActionLoading.value = false
  }
}

async function wakeStreamingHost(host: StreamingHost) {
  streamingActionLoading.value = true
  streamingError.value = ''
  streamingMessage.value = ''
  try {
    const res = await streamingGatewayApi.wakeHost(host.id)
    streamingMessage.value = `${label('已发送 Wake-on-LAN。', 'Wake-on-LAN sent.')} ${res.data.broadcast_address}:${res.data.port}`
  } catch {
    streamingError.value = label('发送 Wake-on-LAN 失败，请确认 MAC 地址。', 'Failed to send Wake-on-LAN; check the MAC address.')
  } finally {
    streamingActionLoading.value = false
  }
}

async function removeStreamingHost(host: StreamingHost) {
  streamingActionLoading.value = true
  streamingError.value = ''
  streamingMessage.value = ''
  try {
    await streamingGatewayApi.removeHost(host.id)
    streamingMessage.value = label('Sunshine 主机已移除。', 'Sunshine host removed.')
    await loadStreamingHosts()
    await loadIntegrations()
  } catch {
    streamingError.value = label('移除 Sunshine 主机失败。', 'Failed to remove Sunshine host.')
  } finally {
    streamingActionLoading.value = false
  }
}

async function probeWorkspaceTarget(target: RemoteWorkspaceTarget) {
  targetActionLoading.value = true
  targetError.value = ''
  targetMessage.value = ''
  try {
    const res = await remoteWorkspaceApi.probeTarget(target.id)
    const data = res.data
    workspaceTargetProbes.value = {
      ...workspaceTargetProbes.value,
      [target.id]: data,
    }
    targetMessage.value = data.reachable
      ? label('目标探测通过。', 'Target probe passed.')
      : label('目标探测失败。', 'Target probe failed.')
  } catch {
    targetError.value = label('目标探测失败。', 'Failed to probe target.')
  } finally {
    targetActionLoading.value = false
  }
}

async function startWorkspace() {
  workspaceActionLoading.value = true
  workspaceActionMessage.value = ''
  workspaceError.value = ''
  try {
    const res = await remoteWorkspaceApi.start()
    const data = res.data
    workspaceActionMessage.value = data.message || (
      data.status === 'started'
        ? label('已请求启动 code-server。', 'code-server start requested.')
        : data.status === 'starting'
          ? label('code-server 正在启动，稍后重新探测。', 'code-server is starting; probe again shortly.')
        : data.status
    )
    await loadWorkspaceStatus()
    await loadWorkspaceTargets()
  } catch {
    workspaceError.value = label('启动 code-server 失败。', 'Failed to start code-server.')
  } finally {
    workspaceActionLoading.value = false
  }
}

async function stopWorkspace() {
  workspaceActionLoading.value = true
  workspaceActionMessage.value = ''
  workspaceError.value = ''
  try {
    const res = await remoteWorkspaceApi.stop()
    workspaceActionMessage.value = res.data.message || res.data.status
    await loadWorkspaceStatus()
    await loadWorkspaceTargets()
  } catch {
    workspaceError.value = label('停止 code-server 失败。', 'Failed to stop code-server.')
  } finally {
    workspaceActionLoading.value = false
  }
}

async function registerWorkspaceTarget() {
  if (!targetLabel.value.trim() || !targetEndpoint.value.trim()) return
  targetActionLoading.value = true
  targetError.value = ''
  targetMessage.value = ''
  try {
    await remoteWorkspaceApi.registerTarget({
      label: targetLabel.value.trim(),
      endpoint: targetEndpoint.value.trim(),
      workspace_root: targetRoot.value.trim(),
      auth_mode: targetAuthMode.value,
    })
    targetLabel.value = ''
    targetEndpoint.value = ''
    targetRoot.value = ''
    targetAuthMode.value = 'ssh_key_or_agent'
    showTargetForm.value = false
    targetMessage.value = label('工作区目标已登记。', 'Workspace target registered.')
    await loadWorkspaceTargets()
    await loadIntegrations()
  } catch {
    targetError.value = label('登记工作区目标失败。', 'Failed to register workspace target.')
  } finally {
    targetActionLoading.value = false
  }
}

async function removeWorkspaceTarget(target: RemoteWorkspaceTarget) {
  if (target.source === 'sidecar') return
  targetActionLoading.value = true
  targetError.value = ''
  targetMessage.value = ''
  try {
    await remoteWorkspaceApi.removeTarget(target.id)
    targetMessage.value = label('工作区目标已移除。', 'Workspace target removed.')
    await loadWorkspaceTargets()
    await loadIntegrations()
  } catch {
    targetError.value = label('移除工作区目标失败。', 'Failed to remove workspace target.')
  } finally {
    targetActionLoading.value = false
  }
}

function statusLabel(record?: ExternalIntegrationRecord) {
  if (!record) return label('未登记', 'Missing')
  return record.enabled ? label('已启用', 'Enabled') : label('已登记 / 待接线', 'Registered / Pending')
}

function statusClass(record?: ExternalIntegrationRecord) {
  if (!record) return 'missing'
  return record.enabled ? 'enabled' : 'pending'
}

function formatAuth(record?: ExternalIntegrationRecord): string {
  if (!record) return label('认证边界尚未登记', 'Auth boundary not registered')
  const auth = record.metadata?.auth as Record<string, unknown> | undefined
  if (!auth || typeof auth !== 'object') return label('未声明独立认证', 'Independent auth not declared')
  const mode = optionalText(auth.mode ?? auth.strategy)
  const owner = optionalText(auth.credentials_owned_by ?? auth.owner)
  const action = optionalText(auth.status_action ?? auth.identity_action ?? auth.login_action)
  const parts = [
    mode ? `${label('认证', 'Auth')}: ${mode}` : '',
    owner ? `${label('归属', 'Owner')}: ${owner}` : '',
    action ? `${label('状态', 'Status')}: ${action}` : '',
  ].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : label('已声明独立认证', 'Independent auth declared')
}

function capabilityIds(lane: LaneSpec & { integration?: ExternalIntegrationRecord }) {
  const ids = lane.integration?.capability_ids ?? []
  return ids.length > 0 ? ids : lane.fallbackCapabilities
}

function endpointText(record?: ExternalIntegrationRecord): string {
  return optionalText(record?.endpoint) || label('等待登记真实端点', 'Waiting for a real endpoint')
}

function canOpenEndpoint(record?: ExternalIntegrationRecord): boolean {
  const endpoint = optionalText(record?.endpoint)
  return endpoint.startsWith('http://') || endpoint.startsWith('https://')
}

function openEndpoint(record?: ExternalIntegrationRecord) {
  if (!canOpenEndpoint(record)) return
  window.open(record?.endpoint, '_blank', 'noopener,noreferrer')
}

function openWorkspace() {
  if (!workspaceOpenUrl.value) return
  window.open(workspaceOpenUrl.value, '_blank', 'noopener,noreferrer')
}

function openStreamingRuntime() {
  const endpoint = streamingRuntimeStatus.value?.endpoint
  if (!endpoint || !endpoint.startsWith('http')) return
  window.open(endpoint, '_blank', 'noopener,noreferrer')
}

function canOpenTarget(target: RemoteWorkspaceTarget): boolean {
  return target.endpoint.startsWith('http://') || target.endpoint.startsWith('https://')
}

function openTarget(target: RemoteWorkspaceTarget) {
  if (!canOpenTarget(target)) return
  window.open(target.endpoint, '_blank', 'noopener,noreferrer')
}

async function loadFilesystem(path = filesystemPath.value) {
  filesystemLoading.value = true
  filesystemError.value = ''
  try {
    const res = await remoteWorkspaceApi.fileTree({
      targetId: filesystemTargetId.value,
      path,
      limit: 240,
    })
    filesystemList.value = res.data
    filesystemPath.value = res.data.path
    filesystemPreview.value = null
  } catch (error) {
    filesystemError.value = error instanceof Error ? error.message : label('无法读取文件树。', 'Failed to read file tree.')
  } finally {
    filesystemLoading.value = false
  }
}

async function openFilesystemEntry(entry: RemoteWorkspaceFileEntry) {
  if (entry.type === 'directory') {
    await loadFilesystem(entry.path)
    return
  }
  if (entry.type !== 'file') return
  filesystemLoading.value = true
  filesystemError.value = ''
  try {
    const res = await remoteWorkspaceApi.filePreview({
      targetId: filesystemTargetId.value,
      path: entry.path,
    })
    filesystemPreview.value = res.data
  } catch (error) {
    filesystemError.value = error instanceof Error ? error.message : label('无法预览文件。', 'Failed to preview file.')
  } finally {
    filesystemLoading.value = false
  }
}

function refreshFilesystem() {
  loadFilesystem(filesystemPath.value)
}

function goFilesystemParent() {
  loadFilesystem(filesystemParentPath.value)
}

function formatFileSize(value: number | null): string {
  if (value == null) return ''
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

function optionalText(value: unknown): string {
  return String(value ?? '').trim()
}

onMounted(loadIntegrations)
onMounted(loadWorkspaceStatus)
onMounted(loadWorkspaceTargets)
onMounted(loadStreamingHosts)
onMounted(loadStreamingRuntimeStatus)
onMounted(() => loadFilesystem(''))
</script>

<template>
  <div class="remote-page">
    <WorkspaceHeader
      :loading="loading"
      :label="label"
      @refresh="loadIntegrations"
      @open-integrations="router.push('/authorizations')"
    />

    <WorkspaceModuleTabs
      v-model:active-panel="activePanel"
      :panels="workspacePanels"
      :label="label"
    />

    <WorkspaceSummaryStrip
      v-show="activePanel === 'overview'"
      :filesystem-ready="Boolean(filesystemList)"
      :ready-ssh-target-count="readySshTargetCount"
      :registered-lane-count="registeredLaneCount"
      :lane-count="lanes.length"
      :loading="loading"
      :label="label"
      @go-files="activePanel = 'files'"
      @go-terminal="activePanel = 'terminal'"
      @go-remote="activePanel = 'remote'"
    />

    <RuntimeStatusPanel
      v-show="activePanel === 'overview'"
      :status="workspaceStatus"
      :loading="workspaceLoading"
      :action-loading="workspaceActionLoading"
      :error="workspaceError"
      :message="workspaceActionMessage"
      :open-url="workspaceOpenUrl"
      :label="label"
      @probe="loadWorkspaceStatus"
      @open="openWorkspace"
      @start="startWorkspace"
      @stop="stopWorkspace"
    />

    <details v-show="activePanel === 'remote'" class="remote-hosts-panel" open>
      <summary>
        <span>{{ label('远程主机扩展', 'Remote Host Extensions') }}</span>
        <strong>{{ readySshTargetCount }}/{{ workspaceTargets.length }}</strong>
      </summary>

      <RemoteHostsPanel
        v-model:target-label="targetLabel"
        v-model:target-endpoint="targetEndpoint"
        v-model:target-root="targetRoot"
        v-model:target-auth-mode="targetAuthMode"
        :targets="workspaceTargets"
        :probes="workspaceTargetProbes"
        :action-loading="targetActionLoading"
        :error="targetError"
        :message="targetMessage"
        :show-form="showTargetForm"
        :label="label"
        :can-open-target="canOpenTarget"
        @refresh-targets="loadWorkspaceTargets"
        @toggle-form="showTargetForm = !showTargetForm"
        @register-target="registerWorkspaceTarget"
        @probe-target="probeWorkspaceTarget"
        @remove-target="removeWorkspaceTarget"
        @open-target="openTarget"
      />

      <LaneGrid
        :lanes="lanes"
        :error="errorMessage"
        :label="label"
        :status-label="statusLabel"
        :status-class="statusClass"
        :endpoint-text="endpointText"
        :can-open-endpoint="canOpenEndpoint"
        :capability-ids="capabilityIds"
        :format-auth="formatAuth"
        @open-endpoint="openEndpoint"
      />
    </details>

    <LocalTerminalPanel v-show="activePanel === 'terminal'" :targets="terminalTargets" :label="label" />

    <section v-show="activePanel === 'files'" class="workbench-shell">
      <LocalFilesystemPanel
        v-model:target-id="filesystemTargetId"
        :targets="filesystemTargets"
        :list="filesystemList"
        :preview="filesystemPreview"
        :loading="filesystemLoading"
        :error="filesystemError"
        :root-fallback="workspaceStatus?.launch.cwd || ''"
        :label="label"
        :format-file-size="formatFileSize"
        @refresh="refreshFilesystem"
        @parent="goFilesystemParent"
        @open-entry="openFilesystemEntry"
      />

      <OptionalWorkspaceViewport
        :status="workspaceStatus"
        :open-url="workspaceOpenUrl"
        :can-show-frame="canShowWorkspaceFrame"
        :label="label"
        @open="openWorkspace"
      />
    </section>

    <NetworkAccessPanel
      v-show="activePanel === 'network'"
      :specs="networkAccessSpecs"
      :registered="Boolean(networkAccessIntegration)"
      :label="label"
      @refresh="loadIntegrations"
      @register="router.push('/authorizations')"
    />

    <StreamingGatewayPanel
      v-show="activePanel === 'streaming'"
      :specs="streamingGatewaySpecs"
      :hosts="streamingHosts"
      :probes="streamingHostProbes"
      :runtime-status="streamingRuntimeStatus"
      :registered="Boolean(streamingGatewayIntegration)"
      :loading="streamingLoading"
      :action-loading="streamingActionLoading"
      :error="streamingError"
      :message="streamingMessage"
      :show-form="showStreamingHostForm"
      :host-label="streamingHostLabel"
      :host-endpoint="streamingHostEndpoint"
      :host-base-port="streamingHostBasePort"
      :host-mac="streamingHostMac"
      :host-room="streamingHostRoom"
      :host-network-path="streamingHostNetworkPath"
      :label="label"
      @refresh-hosts="loadStreamingHosts"
      @refresh-runtime="loadStreamingRuntimeStatus"
      @toggle-form="showStreamingHostForm = !showStreamingHostForm"
      @register-host="registerStreamingHost"
      @probe-host="probeStreamingHost"
      @wake-host="wakeStreamingHost"
      @remove-host="removeStreamingHost"
      @open-runtime="openStreamingRuntime"
      @update:host-label="streamingHostLabel = $event"
      @update:host-endpoint="streamingHostEndpoint = $event"
      @update:host-base-port="streamingHostBasePort = $event"
      @update:host-mac="streamingHostMac = $event"
      @update:host-room="streamingHostRoom = $event"
      @update:host-network-path="streamingHostNetworkPath = $event"
    />

  </div>
</template>
