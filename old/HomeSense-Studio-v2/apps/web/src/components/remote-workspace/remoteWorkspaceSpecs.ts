export type LabelFn = (zh: string, en: string) => string

export type WorkspacePanelKey = 'overview' | 'terminal' | 'files' | 'network' | 'streaming' | 'remote'

export type LaneSpec = {
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

export type NetworkAccessSpec = {
  key: string
  title: string
  subtitle: string
  status: string
  endpoint: string
  capabilities: string[]
}

export type StreamingGatewaySpec = {
  key: string
  title: string
  subtitle: string
  status: string
  detail: string
  capabilities: string[]
}

export function buildWorkspacePanels(label: LabelFn): Array<{ key: WorkspacePanelKey; label: string; short: string }> {
  return [
    { key: 'overview', label: label('总览', 'Overview'), short: label('总览', 'Home') },
    { key: 'terminal', label: label('本机终端', 'Terminal'), short: label('终端', 'TTY') },
    { key: 'files', label: label('文件系统', 'Files'), short: label('文件', 'Files') },
    { key: 'network', label: label('网络入口', 'Network'), short: label('网络', 'Net') },
    { key: 'streaming', label: label('串流网关', 'Streaming'), short: label('串流', 'Stream') },
    { key: 'remote', label: label('远程扩展', 'Remote'), short: label('远程', 'SSH') },
  ]
}

export function buildLaneSpecs(label: LabelFn): LaneSpec[] {
  return [
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
  ]
}

export function buildNetworkAccessSpecs(options: {
  label: LabelFn
  localEndpoint: string
  readySshTargetCount: number
  targetCount: number
}): NetworkAccessSpec[] {
  const { label, localEndpoint, readySshTargetCount, targetCount } = options
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
      status: readySshTargetCount > 0 ? label('已有目标', 'Targets Ready') : label('待登记', 'Pending'),
      endpoint: `${readySshTargetCount}/${targetCount}`,
      capabilities: ['terminal.ssh.connect', 'terminal.session.open'],
    },
  ]
}

export function buildStreamingGatewaySpecs(options: {
  label: LabelFn
  registeredStreamingHostCount: number
  hasMoonlightWebRuntime: boolean
}): StreamingGatewaySpec[] {
  const { label, registeredStreamingHostCount, hasMoonlightWebRuntime } = options
  return [
    {
      key: 'sunshine-hosts',
      title: label('Sunshine 主机', 'Sunshine Hosts'),
      subtitle: label('登记家里的高性能电脑、工作站或游戏主机。', 'Register gaming PCs, workstations, or high-performance hosts at home.'),
      status: registeredStreamingHostCount > 0 ? label('已有主机', 'Hosts Ready') : label('待登记', 'Pending'),
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
      status: hasMoonlightWebRuntime ? label('已登记', 'Registered') : label('预留', 'Reserved'),
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
  ]
}
