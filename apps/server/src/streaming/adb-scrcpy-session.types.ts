export type AdbScrcpySessionState = 'starting' | 'running' | 'prepared' | 'exited' | 'failed' | 'stopped'

export type AdbScrcpySessionInput = {
  device?: string
  profile?: 'browser_bridge' | 'desktop' | 'record' | 'headless' | string
  max_size?: number | string
  bit_rate?: string
  max_fps?: number | string
  video_codec?: 'h264' | 'h265' | 'av1' | string
  display_id?: number | string
  audio?: boolean
  control?: boolean
  window?: boolean
  playback?: boolean
  tunnel_mode?: 'auto' | 'forward' | string
  record?: string
  v4l2_sink?: string
  extra_args?: string[]
  label?: string
  dry_run?: boolean
}

export type AdbScrcpyRawBridge = {
  kind: 'raw_h264'
  ws_path: string
  local_host: string
  local_port: number
  socket_name: string
  scid: string
  device_server_path: string
  server_version: string
  ready: boolean
  mime: 'video/h264'
  notes: string[]
}

export type AdbScrcpyCommandSpec = {
  executable: string
  args: string[]
  argv: string[]
  command_line: string
  device: string
  profile: string
  headless: boolean
  window: boolean
  playback: boolean
  audio: boolean
  control: boolean
  tunnel_mode: string
  direct_cli_video: boolean
  effective_video: boolean
  requires_backend_bridge: boolean
  bridge_strategy: string
  notes: string[]
}

export type AdbScrcpySession = {
  id: string
  label: string
  device: string
  state: AdbScrcpySessionState
  created_at: string
  updated_at: string
  started_at?: string
  exited_at?: string
  exit_code?: number | null
  signal?: NodeJS.Signals | null
  pid?: number
  command: AdbScrcpyCommandSpec
  stream?: AdbScrcpyRawBridge
  dry_run: boolean
  stdout_tail: string[]
  stderr_tail: string[]
  error?: string
  notes: string[]
}
