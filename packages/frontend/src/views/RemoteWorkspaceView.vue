<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
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
      @open-integrations="router.push('/integrations')"
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
      @register="router.push('/integrations')"
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

<style>
.remote-page {
  height: 100%;
  overflow-y: auto;
  padding: 40px;
  display: flex;
  flex-direction: column;
  gap: 28px;
  background: #f7f9fa;
  --workspace-mobile-tabs-height: 76px;
  --workspace-main-mobile-nav-height: var(--app-mobile-nav-height, 72px);
}

.workspace-head {
  display: flex;
  justify-content: space-between;
  gap: 32px;
  padding: 36px;
  border: 1px solid rgba(226, 232, 240, 0.85);
  border-radius: 24px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 8px 32px rgba(15, 23, 42, 0.04);
}

.eyebrow {
  display: inline-flex;
  margin-bottom: 16px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(15, 118, 110, 0.08);
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.12em;
}

h1 {
  margin: 0;
  color: var(--text-primary);
  font-size: 34px;
  font-weight: 900;
  line-height: 1.15;
}

.workspace-head p {
  max-width: 760px;
  margin: 14px 0 0;
  color: var(--text-secondary);
  font-size: 15px;
  font-weight: 650;
  line-height: 1.7;
}

.head-actions {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  flex-shrink: 0;
}

.runtime-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.primary-btn,
.secondary-btn {
  height: 40px;
  padding: 0 16px;
  border-radius: 10px;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.primary-btn {
  border: 1px solid #0f766e;
  background: #0f766e;
  color: #fff;
}

.secondary-btn {
  border: 1px solid rgba(15, 118, 110, 0.22);
  background: rgba(15, 118, 110, 0.07);
  color: #0f766e;
}

.danger-btn {
  height: 40px;
  padding: 0 16px;
  border-radius: 10px;
  border: 1px solid rgba(220, 38, 38, 0.22);
  background: rgba(220, 38, 38, 0.08);
  color: #b91c1c;
  font-size: 13px;
  font-weight: 900;
  cursor: pointer;
  white-space: nowrap;
}

.primary-btn:disabled,
.secondary-btn:disabled,
.danger-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.summary-strip {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 14px;
}

.workspace-tabs {
  position: sticky;
  top: 0;
  z-index: 8;
  padding: 8px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(12px);
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 6px;
}

.workspace-tab {
  min-height: 46px;
  padding: 6px 10px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
}

.workspace-tab span {
  color: var(--text-tertiary);
  font-size: 10px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.workspace-tab strong {
  color: inherit;
  font-size: 13px;
  font-weight: 900;
}

.workspace-tab.active {
  border-color: rgba(15, 118, 110, 0.22);
  background: rgba(15, 118, 110, 0.08);
  color: #0f766e;
}

.summary-item {
  min-height: 76px;
  padding: 18px 20px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 18px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.summary-action {
  text-align: left;
  cursor: pointer;
}

.summary-action:hover {
  border-color: rgba(15, 118, 110, 0.22);
}

.summary-item span {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.summary-item strong {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 900;
}

.remote-hosts-panel {
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 18px;
  background: rgba(255, 255, 255, 0.72);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.025);
  overflow: hidden;
}

.remote-hosts-panel summary {
  min-height: 58px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  cursor: pointer;
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.remote-hosts-panel summary::marker {
  color: #0f766e;
}

.remote-hosts-panel summary strong {
  color: #0f766e;
  font-size: 13px;
  font-weight: 900;
}

.remote-hosts-panel > .runtime-panel,
.remote-hosts-panel > .lane-grid,
.remote-hosts-panel > .error-line {
  margin: 0 16px 16px;
}

.network-access-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.network-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.network-card {
  min-height: 178px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.74);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.network-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.network-card-head span {
  display: inline-flex;
  margin-bottom: 4px;
  color: #0891b2;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.network-card h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 900;
}

.network-card-head strong {
  color: #0891b2;
  font-size: 12px;
  font-weight: 900;
}

.network-card p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.55;
}

.network-card code {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.06);
  color: #334155;
  font-size: 12px;
  font-weight: 750;
  word-break: break-all;
}

.streaming-gateway-panel {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.streaming-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.streaming-host-form {
  grid-template-columns: repeat(6, minmax(0, 1fr));
}

.streaming-host-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 12px;
}

.streaming-host-card {
  min-height: 188px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 16px;
  background: #fff;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.streaming-host-card code {
  padding: 8px 10px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.06);
  color: #334155;
  font-size: 12px;
  font-weight: 750;
  word-break: break-all;
}

.streaming-host-card small {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 750;
  line-height: 1.45;
  word-break: break-all;
}

.streaming-card {
  min-height: 196px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 16px;
  background: rgba(255, 247, 247, 0.68);
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.streaming-card-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.streaming-card-head span {
  display: inline-flex;
  margin-bottom: 4px;
  color: #dc2626;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.streaming-card h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 900;
}

.streaming-card-head strong {
  color: #dc2626;
  font-size: 12px;
  font-weight: 900;
}

.streaming-card p,
.streaming-card small {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.55;
}

.streaming-card small {
  color: var(--text-tertiary);
  font-size: 12px;
}

.runtime-panel {
  padding: 24px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.035);
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.terminal-panel {
  gap: 14px;
}

.runtime-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
}

.eyebrow.inline {
  margin-bottom: 10px;
}

.runtime-head h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 900;
}

.target-select {
  height: 40px;
  min-width: 180px;
  padding: 0 12px;
  border: 1px solid rgba(15, 118, 110, 0.22);
  border-radius: 10px;
  background: #fff;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
}

.runtime-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.runtime-card {
  min-height: 106px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.85);
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.72);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.runtime-card.span-two {
  grid-column: span 2;
}

.runtime-card span {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.runtime-card strong {
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 900;
  line-height: 1.3;
}

.runtime-card strong.ok {
  color: #0f766e;
}

.runtime-card small,
.runtime-card code {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 750;
  line-height: 1.45;
  word-break: break-all;
}

.runtime-card code {
  padding: 8px 10px;
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.06);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.note-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.candidate-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.candidate-list span {
  padding: 4px 7px;
  border-radius: 7px;
  background: rgba(15, 23, 42, 0.05);
  color: #334155;
  font-size: 11px;
  font-weight: 800;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  text-transform: none;
  letter-spacing: 0;
}

.empty-line {
  padding: 24px;
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.72);
  color: var(--text-tertiary);
  font-size: 13px;
  font-weight: 800;
  text-align: center;
}

.error-line {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(239, 68, 68, 0.08);
  color: #b91c1c;
  font-size: 13px;
  font-weight: 800;
}

.info-line {
  margin: 0;
  padding: 12px 14px;
  border-radius: 10px;
  background: rgba(15, 118, 110, 0.08);
  color: #0f766e;
  font-size: 13px;
  font-weight: 800;
}

.terminal-output {
  position: relative;
  min-height: 260px;
  height: 320px;
  margin: 0;
  padding: 12px;
  border-radius: 14px;
  background: #0f172a;
  color: #d1fae5;
  overflow: auto;
}

.terminal-output :deep(.xterm) {
  height: 100%;
}

.terminal-placeholder {
  position: absolute;
  left: 18px;
  top: 18px;
  color: #94a3b8;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  font-weight: 700;
  pointer-events: none;
}

.terminal-input-row {
  display: flex;
  gap: 10px;
  align-items: center;
}

.terminal-input-row input {
  flex: 1;
  height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 10px;
  background: #fff;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
}

.lane-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 18px;
}

.lane-card {
  padding: 24px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 22px;
  background: #fff;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.035);
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.lane-card.primary {
  border-color: rgba(15, 118, 110, 0.28);
  box-shadow: 0 18px 36px rgba(15, 118, 110, 0.08);
}

.lane-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.lane-marker {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 36px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--accent) 11%, white);
  color: var(--accent);
  font-size: 13px;
  font-weight: 950;
}

.status-chip {
  padding: 5px 9px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 900;
}

.status-chip.enabled {
  background: rgba(16, 185, 129, 0.1);
  color: #047857;
}

.status-chip.pending {
  background: rgba(245, 158, 11, 0.12);
  color: #92400e;
}

.status-chip.missing {
  background: rgba(148, 163, 184, 0.12);
  color: #64748b;
}

.lane-card h2 {
  margin: 0;
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 900;
}

.lane-subtitle,
.lane-role {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 650;
  line-height: 1.55;
}

.lane-role {
  min-height: 62px;
}

.endpoint-box {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(15, 23, 42, 0.03);
}

.endpoint-box span {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.endpoint-box strong {
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 800;
  line-height: 1.45;
  word-break: break-all;
}

.open-link-btn {
  align-self: flex-start;
  padding: 6px 10px;
  border: 1px solid rgba(15, 118, 110, 0.24);
  border-radius: 8px;
  background: rgba(15, 118, 110, 0.08);
  color: #0f766e;
  font-size: 11px;
  font-weight: 900;
  cursor: pointer;
}

.open-link-btn:hover {
  background: rgba(15, 118, 110, 0.14);
}

.open-link-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.lane-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.block-title {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.cap-chip,
.ref-chip {
  padding: 4px 8px;
  border-radius: 7px;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.35;
}

.cap-chip {
  background: rgba(15, 23, 42, 0.05);
  color: #334155;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
}

.ref-chip {
  background: color-mix(in srgb, var(--accent) 9%, white);
  color: var(--accent);
}

.auth-line {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid rgba(226, 232, 240, 0.9);
  color: #0f766e;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.45;
}

.workbench-shell {
  display: grid;
  grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.55fr);
  gap: 18px;
  min-height: 260px;
}

.workspace-shell,
.filesystem-shell {
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 22px;
  background: #fff;
  overflow: hidden;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.035);
}

.shell-head {
  height: 54px;
  padding: 0 20px;
  border-bottom: 1px solid rgba(226, 232, 240, 0.85);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.shell-title {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.shell-head span {
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 900;
}

.shell-head small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 800;
}

.shell-body {
  min-height: 206px;
  padding: 22px;
  background: #0f172a;
  color: #d1fae5;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 13px;
  display: flex;
  gap: 10px;
  align-items: flex-start;
}

.prompt {
  color: #34d399;
  font-weight: 900;
}

.filesystem-note {
  min-height: 206px;
}

.filesystem-pathline {
  padding: 12px 20px 0;
}

.filesystem-pathline small {
  display: block;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
  word-break: break-all;
}

.filesystem-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.95fr) minmax(0, 1.05fr);
  gap: 0;
  min-height: 460px;
}

.filesystem-tree {
  border-right: 1px solid rgba(226, 232, 240, 0.85);
  padding: 12px;
  overflow: auto;
}

.filesystem-entry {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 14px;
  border: 1px solid transparent;
  border-radius: 12px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}

.filesystem-entry:hover {
  background: rgba(37, 99, 235, 0.05);
  border-color: rgba(37, 99, 235, 0.14);
}

.filesystem-entry.directory .entry-name {
  color: #1d4ed8;
}

.filesystem-entry.file .entry-name {
  color: #0f172a;
}

.filesystem-entry.symlink .entry-name {
  color: #7c3aed;
}

.entry-name {
  font-size: 13px;
  font-weight: 850;
  word-break: break-all;
}

.entry-meta {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 700;
}

.filesystem-hint {
  padding: 8px 14px 0;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 700;
}

.filesystem-preview {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: #0f172a;
  color: #d1fae5;
}

.preview-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid rgba(148, 163, 184, 0.16);
}

.preview-head strong {
  color: #e2e8f0;
  font-size: 13px;
  font-weight: 900;
  word-break: break-all;
}

.preview-head small {
  color: #94a3b8;
  font-size: 11px;
  font-weight: 700;
  text-align: right;
}

.preview-body {
  margin: 0;
  padding: 16px;
  flex: 1;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: #d1fae5;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.workspace-frame-wrap {
  min-height: 460px;
  background: #0b1220;
}

.workspace-frame {
  display: block;
  width: 100%;
  min-height: 460px;
  border: 0;
  background: #0b1220;
}

.target-form {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
  align-items: end;
}

.target-form label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.target-form span {
  color: var(--text-tertiary);
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.target-form input,
.target-form select {
  height: 40px;
  padding: 0 12px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 10px;
  background: #fff;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 750;
}

.target-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: 12px;
}

.target-card {
  min-height: 184px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 16px;
  background: rgba(248, 250, 252, 0.72);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.target-top {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.target-kind {
  display: inline-flex;
  margin-bottom: 4px;
  color: #0f766e;
  font-size: 11px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.target-card h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 900;
}

.target-card strong,
.target-card small {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 750;
  line-height: 1.45;
  word-break: break-all;
}

.target-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: auto;
}

.target-probe {
  padding: 10px;
  border-radius: 10px;
  background: rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.target-probe code {
  color: #334155;
  font-size: 11px;
  font-weight: 750;
  line-height: 1.4;
  word-break: break-all;
}

.danger-inline {
  border-color: rgba(220, 38, 38, 0.24);
  background: rgba(220, 38, 38, 0.08);
  color: #b91c1c;
}

@media (max-width: 1100px) {
  .remote-page {
    padding: 24px 18px calc(96px + var(--workspace-main-mobile-nav-height) + env(safe-area-inset-bottom, 0px));
  }

  .workspace-head,
  .workbench-shell {
    display: flex;
    flex-direction: column;
  }

  .workspace-head {
    flex-direction: column;
  }

  .summary-strip,
  .lane-grid,
  .runtime-grid,
  .target-form {
    grid-template-columns: 1fr;
  }

  .runtime-card.span-two {
    grid-column: auto;
  }
}

@media (max-width: 720px) {
  .workspace-head {
    padding: 22px;
    border-radius: 18px;
  }

  .workspace-head p {
    display: none;
  }

  h1 {
    font-size: 24px;
  }

  .head-actions {
    width: 100%;
    align-items: stretch;
  }

  .head-actions .primary-btn,
  .head-actions .secondary-btn {
    flex: 1;
  }

  .workspace-tabs {
    position: fixed;
    left: calc(12px + env(safe-area-inset-left, 0px));
    right: calc(12px + env(safe-area-inset-right, 0px));
    bottom: calc(18px + var(--workspace-main-mobile-nav-height) + env(safe-area-inset-bottom, 0px));
    top: auto;
    grid-template-columns: repeat(6, minmax(0, 1fr));
    border-radius: 18px;
    box-shadow: 0 14px 38px rgba(15, 23, 42, 0.18);
  }

  .workspace-tab {
    min-height: 52px;
    padding: 6px 4px;
    align-items: center;
    text-align: center;
  }

  .workspace-tab span {
    font-size: 10px;
  }

  .workspace-tab strong {
    display: none;
  }

  .runtime-head,
  .shell-head {
    flex-direction: column;
    align-items: stretch;
    height: auto;
    padding-top: 14px;
    padding-bottom: 14px;
  }

  .runtime-actions {
    width: 100%;
  }

  .runtime-actions .primary-btn,
  .runtime-actions .secondary-btn,
  .runtime-actions .danger-btn,
  .runtime-actions .target-select {
    flex: 1;
    min-width: 0;
  }

  .filesystem-grid {
    grid-template-columns: 1fr;
  }

  .filesystem-tree {
    border-right: 0;
    border-bottom: 1px solid rgba(226, 232, 240, 0.85);
    max-height: 300px;
  }

  .terminal-output {
    height: calc(100dvh - 310px - var(--workspace-mobile-tabs-height) - var(--workspace-main-mobile-nav-height) - env(safe-area-inset-bottom, 0px));
    min-height: 300px;
  }
}
</style>
