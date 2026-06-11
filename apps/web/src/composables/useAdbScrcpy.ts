import { onBeforeUnmount, ref, type Ref } from 'vue'
import { streamingGatewayApi, type AdbScrcpySession } from '@/api/streamingGateway'

type LabelFn = (zh: string, en: string) => string

export function useAdbScrcpy(options: {
  adbIp: () => string
  deviceName: () => string
  label: LabelFn
  statusMessage: Ref<string>
  errorMessage: Ref<string>
}) {
  const scrcpyLoading = ref(false)
  const scrcpySessions = ref<AdbScrcpySession[]>([])
  const scrcpyMaxSize = ref('1280')
  const scrcpyBitRate = ref('4M')
  const scrcpyMaxFps = ref('30')
  const scrcpyRecordPath = ref('')
  const scrcpyV4l2Sink = ref('')
  const rawStreamSessionId = ref('')
  const rawStreamStatus = ref('')
  const rawStreamBytes = ref(0)
  let rawStreamSocket: WebSocket | null = null

  async function loadScrcpySessions() {
    if (scrcpyLoading.value) return
    scrcpyLoading.value = true
    try {
      const result = await streamingGatewayApi.adbScrcpySessions()
      if (result.status === 'success') scrcpySessions.value = result.data
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      scrcpyLoading.value = false
    }
  }

  function scrcpyBasePayload(profile: string) {
    return {
      device: options.adbIp(),
      profile,
      max_size: scrcpyMaxSize.value.trim() || undefined,
      bit_rate: scrcpyBitRate.value.trim() || undefined,
      max_fps: scrcpyMaxFps.value.trim() || undefined,
      label: `${options.deviceName()} scrcpy`,
    }
  }

  async function createScrcpyBridgeSession() {
    if (scrcpyLoading.value) return
    scrcpyLoading.value = true
    options.statusMessage.value = ''
    options.errorMessage.value = ''
    try {
      const result = await streamingGatewayApi.createAdbScrcpySession({
        ...scrcpyBasePayload('browser_bridge'),
        audio: false,
        window: false,
        playback: false,
        v4l2_sink: scrcpyV4l2Sink.value.trim() || undefined,
      })
      if (result.status !== 'success') {
        options.errorMessage.value = options.label('scrcpy 会话创建失败', 'Failed to create scrcpy session')
        return
      }
      await loadScrcpySessions()
      options.statusMessage.value = result.data.state === 'prepared'
        ? options.label('scrcpy 桥接规格已准备', 'scrcpy bridge spec prepared')
        : options.label('scrcpy 会话已启动', 'scrcpy session started')
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      scrcpyLoading.value = false
    }
  }

  async function createScrcpyDesktopSession() {
    if (scrcpyLoading.value) return
    scrcpyLoading.value = true
    options.statusMessage.value = ''
    options.errorMessage.value = ''
    try {
      const result = await streamingGatewayApi.createAdbScrcpySession({
        ...scrcpyBasePayload('desktop'),
        audio: true,
        window: true,
        playback: true,
      })
      if (result.status !== 'success') {
        options.errorMessage.value = options.label('scrcpy 启动失败', 'Failed to start scrcpy')
        return
      }
      await loadScrcpySessions()
      options.statusMessage.value = options.label('scrcpy 桌面会话已启动', 'scrcpy desktop session started')
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      scrcpyLoading.value = false
    }
  }

  async function createScrcpyRecordSession() {
    const record = scrcpyRecordPath.value.trim()
    if (!record) {
      options.errorMessage.value = options.label('请输入录制文件路径', 'Enter a recording path')
      return
    }
    if (scrcpyLoading.value) return
    scrcpyLoading.value = true
    options.statusMessage.value = ''
    options.errorMessage.value = ''
    try {
      const result = await streamingGatewayApi.createAdbScrcpySession({
        ...scrcpyBasePayload('record'),
        audio: false,
        window: false,
        playback: false,
        record,
      })
      if (result.status !== 'success') {
        options.errorMessage.value = options.label('scrcpy 录制启动失败', 'Failed to start scrcpy recording')
        return
      }
      await loadScrcpySessions()
      options.statusMessage.value = options.label('scrcpy 录制会话已启动', 'scrcpy recording session started')
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      scrcpyLoading.value = false
    }
  }

  async function stopScrcpySession(id: string) {
    if (scrcpyLoading.value) return
    scrcpyLoading.value = true
    try {
      await streamingGatewayApi.stopAdbScrcpySession(id)
      await loadScrcpySessions()
      options.statusMessage.value = options.label('scrcpy 会话已停止', 'scrcpy session stopped')
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      scrcpyLoading.value = false
    }
  }

  async function removeScrcpySession(id: string) {
    if (scrcpyLoading.value) return
    scrcpyLoading.value = true
    try {
      await streamingGatewayApi.removeAdbScrcpySession(id)
      await loadScrcpySessions()
    } catch (e) {
      options.errorMessage.value = (e as Error).message || String(e)
    } finally {
      scrcpyLoading.value = false
    }
  }

  function buildWsUrl(path: string): string {
    const base = import.meta.env.VITE_API_BASE || window.location.origin
    const url = new URL(path, base || window.location.origin)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return url.toString()
  }

  function disconnectRawStream() {
    rawStreamSocket?.close()
    rawStreamSocket = null
    rawStreamSessionId.value = ''
    rawStreamStatus.value = ''
  }

  function connectRawStream(session: AdbScrcpySession) {
    if (!session.stream?.ws_path) return
    disconnectRawStream()
    rawStreamSessionId.value = session.id
    rawStreamBytes.value = 0
    rawStreamStatus.value = options.label('连接中', 'Connecting')
    const socket = new WebSocket(buildWsUrl(session.stream.ws_path))
    socket.binaryType = 'arraybuffer'
    rawStreamSocket = socket
    socket.onopen = () => {
      rawStreamStatus.value = options.label('已连接，等待 H264 数据', 'Connected, waiting for H264 data')
    }
    socket.onmessage = (event) => {
      const data = event.data
      if (data instanceof ArrayBuffer) rawStreamBytes.value += data.byteLength
      else if (data instanceof Blob) rawStreamBytes.value += data.size
    }
    socket.onerror = () => {
      rawStreamStatus.value = options.label('流连接错误', 'Stream connection error')
    }
    socket.onclose = (event) => {
      rawStreamStatus.value = event.reason || options.label('流已断开', 'Stream disconnected')
      if (rawStreamSocket === socket) rawStreamSocket = null
    }
  }

  onBeforeUnmount(() => {
    disconnectRawStream()
  })

  return {
    scrcpyLoading,
    scrcpySessions,
    scrcpyMaxSize,
    scrcpyBitRate,
    scrcpyMaxFps,
    scrcpyRecordPath,
    scrcpyV4l2Sink,
    rawStreamSessionId,
    rawStreamStatus,
    rawStreamBytes,
    loadScrcpySessions,
    createScrcpyBridgeSession,
    createScrcpyDesktopSession,
    createScrcpyRecordSession,
    stopScrcpySession,
    removeScrcpySession,
    connectRawStream,
    disconnectRawStream,
  }
}
