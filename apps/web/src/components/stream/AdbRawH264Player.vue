<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'

const props = defineProps<{
  wsPath: string
  label: (zh: string, en: string) => string
  interactive?: boolean
  autoplay?: boolean
  showToolbar?: boolean
}>()

const emit = defineEmits<{
  tap: [point: { x: number; y: number; width: number; height: number }]
  swipe: [gesture: { start_x: number; start_y: number; end_x: number; end_y: number; duration: number; width: number; height: number }]
  'state-change': [state: DecoderState]
}>()

type DecoderState = 'idle' | 'connecting' | 'connected' | 'decoding' | 'unsupported' | 'closed' | 'error'

const canvasRef = ref<HTMLCanvasElement | null>(null)
const state = ref<DecoderState>('idle')
const message = ref('')
const bytesReceived = ref(0)
const framesDecoded = ref(0)
const codec = ref('')
const frameSize = ref<{ width: number; height: number } | null>(null)
const dragging = ref(false)

let ws: WebSocket | null = null
let decoder: VideoDecoder | null = null
let nalBuffer = new Uint8Array(0)
let pendingAccessUnit: Uint8Array[] = []
let pendingHasVcl = false
let configured = false
let timestamp = 0
let pointerStart: { id: number; x: number; y: number; time: number } | null = null
let pointerLatest: { x: number; y: number } | null = null

const stateText = computed(() => {
  if (state.value === 'idle') return props.label('未连接', 'Idle')
  if (state.value === 'connecting') return props.label('连接中', 'Connecting')
  if (state.value === 'connected') return props.label('已连接', 'Connected')
  if (state.value === 'decoding') return props.label('解码中', 'Decoding')
  if (state.value === 'unsupported') return props.label('浏览器不支持 WebCodecs', 'WebCodecs unsupported')
  if (state.value === 'closed') return props.label('已断开', 'Closed')
  return props.label('错误', 'Error')
})

function buildWsUrl(path: string): string {
  const base = import.meta.env.VITE_API_BASE || window.location.origin
  const url = new URL(path, base || window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString()
}

function connect() {
  disconnect()
  if (typeof VideoDecoder === 'undefined') {
    state.value = 'unsupported'
    message.value = props.label('当前浏览器没有 VideoDecoder。', 'This browser does not expose VideoDecoder.')
    return
  }

  state.value = 'connecting'
  message.value = ''
  bytesReceived.value = 0
  framesDecoded.value = 0
  codec.value = ''
  frameSize.value = null
  nalBuffer = new Uint8Array(0)
  pendingAccessUnit = []
  pendingHasVcl = false
  configured = false
  timestamp = 0

  decoder = new VideoDecoder({
    output: renderFrame,
    error: (error) => {
      state.value = 'error'
      message.value = error.message
    },
  })

  ws = new WebSocket(buildWsUrl(props.wsPath))
  ws.binaryType = 'arraybuffer'
  ws.onopen = () => {
    state.value = 'connected'
  }
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) {
      bytesReceived.value += event.data.byteLength
      ingestBytes(new Uint8Array(event.data))
    } else if (event.data instanceof Blob) {
      bytesReceived.value += event.data.size
      void event.data.arrayBuffer().then((buffer) => ingestBytes(new Uint8Array(buffer)))
    }
  }
  ws.onerror = () => {
    state.value = 'error'
    message.value = props.label('WebSocket 流连接错误。', 'WebSocket stream error.')
  }
  ws.onclose = (event) => {
    if (state.value !== 'error') {
      state.value = 'closed'
      message.value = event.reason || props.label('流已关闭。', 'Stream closed.')
    }
  }
}

function disconnect() {
  ws?.close()
  ws = null
  if (decoder && decoder.state !== 'closed') {
    decoder.close()
  }
  decoder = null
  pendingAccessUnit = []
  pendingHasVcl = false
  configured = false
  if (state.value !== 'idle') state.value = 'closed'
}

function ingestBytes(bytes: Uint8Array) {
  nalBuffer = concatBytes(nalBuffer, bytes)
  const units = takeCompleteAnnexBUnits()
  for (const unit of units) ingestNal(unit)
}

function takeCompleteAnnexBUnits(): Uint8Array[] {
  const starts = findStartCodes(nalBuffer)
  if (starts.length < 2) return []

  const units: Uint8Array[] = []
  for (let i = 0; i < starts.length - 1; i++) {
    units.push(nalBuffer.slice(starts[i], starts[i + 1]))
  }
  nalBuffer = nalBuffer.slice(starts[starts.length - 1])
  return units
}

function ingestNal(unitWithStartCode: Uint8Array) {
  const nalType = getNalType(unitWithStartCode)
  if (nalType === 7 && !configured) configureDecoder(unitWithStartCode)

  const isVcl = nalType === 1 || nalType === 5
  if (isVcl && pendingHasVcl) flushAccessUnit()
  pendingAccessUnit.push(unitWithStartCode)
  if (isVcl) pendingHasVcl = true
}

function configureDecoder(spsUnit: Uint8Array) {
  const sps = stripStartCode(spsUnit)
  if (sps.length < 4 || !decoder) return
  const profile = sps[1]
  const constraints = sps[2]
  const level = sps[3]
  codec.value = `avc1.${hex2(profile)}${hex2(constraints)}${hex2(level)}`
  decoder.configure({
    codec: codec.value,
    optimizeForLatency: true,
  })
  configured = true
}

function flushAccessUnit() {
  if (!decoder || !configured || pendingAccessUnit.length === 0) {
    pendingAccessUnit = []
    pendingHasVcl = false
    return
  }
  const data = concatMany(pendingAccessUnit)
  const keyFrame = pendingAccessUnit.some((unit) => getNalType(unit) === 5)
  decoder.decode(new EncodedVideoChunk({
    type: keyFrame ? 'key' : 'delta',
    timestamp,
    duration: 33_333,
    data,
  }))
  timestamp += 33_333
  pendingAccessUnit = []
  pendingHasVcl = false
}

function renderFrame(frame: VideoFrame) {
  const canvas = canvasRef.value
  if (!canvas) {
    frame.close()
    return
  }
  if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
    canvas.width = frame.displayWidth
    canvas.height = frame.displayHeight
    frameSize.value = { width: frame.displayWidth, height: frame.displayHeight }
  }
  const ctx = canvas.getContext('2d')
  if (ctx) ctx.drawImage(frame, 0, 0, canvas.width, canvas.height)
  frame.close()
  framesDecoded.value += 1
  state.value = 'decoding'
}

function canvasPoint(event: PointerEvent): { x: number; y: number; width: number; height: number } | null {
  const canvas = canvasRef.value
  if (!canvas || !props.interactive || canvas.width <= 0 || canvas.height <= 0) return null
  const rect = canvas.getBoundingClientRect()
  const x = Math.round(((event.clientX - rect.left) / rect.width) * canvas.width)
  const y = Math.round(((event.clientY - rect.top) / rect.height) * canvas.height)
  return { x, y, width: canvas.width, height: canvas.height }
}

function handleCanvasPointerDown(event: PointerEvent) {
  const point = canvasPoint(event)
  const canvas = canvasRef.value
  if (!point || !canvas) return
  event.preventDefault()
  canvas.setPointerCapture?.(event.pointerId)
  pointerStart = { id: event.pointerId, x: point.x, y: point.y, time: performance.now() }
  pointerLatest = { x: point.x, y: point.y }
  dragging.value = false
}

function handleCanvasPointerMove(event: PointerEvent) {
  if (!pointerStart || pointerStart.id !== event.pointerId) return
  const point = canvasPoint(event)
  if (!point) return
  event.preventDefault()
  pointerLatest = { x: point.x, y: point.y }
  const dx = point.x - pointerStart.x
  const dy = point.y - pointerStart.y
  dragging.value = Math.hypot(dx, dy) >= 18
}

function handleCanvasPointerUp(event: PointerEvent) {
  if (!pointerStart || pointerStart.id !== event.pointerId) return
  const point = canvasPoint(event)
  const start = pointerStart
  pointerStart = null
  pointerLatest = null
  dragging.value = false
  if (!point) return
  event.preventDefault()
  const duration = Math.max(80, Math.min(900, Math.round(performance.now() - start.time)))
  const dx = point.x - start.x
  const dy = point.y - start.y
  if (Math.hypot(dx, dy) >= 18) {
    emit('swipe', {
      start_x: start.x,
      start_y: start.y,
      end_x: point.x,
      end_y: point.y,
      duration,
      width: point.width,
      height: point.height,
    })
    return
  }
  emit('tap', { x: point.x, y: point.y, width: point.width, height: point.height })
}

function handleCanvasPointerCancel(event: PointerEvent) {
  if (pointerStart?.id !== event.pointerId) return
  pointerStart = null
  pointerLatest = null
  dragging.value = false
}

function findStartCodes(bytes: Uint8Array): number[] {
  const starts: number[] = []
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      starts.push(i)
      i += 2
    } else if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 0 && bytes[i + 3] === 1) {
      starts.push(i)
      i += 3
    }
  }
  return starts
}

function startCodeLength(bytes: Uint8Array): number {
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1) return 3
  if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0 && bytes[3] === 1) return 4
  return 0
}

function stripStartCode(bytes: Uint8Array): Uint8Array {
  return bytes.slice(startCodeLength(bytes))
}

function getNalType(bytes: Uint8Array): number {
  const offset = startCodeLength(bytes)
  return offset < bytes.length ? bytes[offset] & 0x1f : 0
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function concatMany(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

function hex2(value: number): string {
  return value.toString(16).padStart(2, '0').toUpperCase()
}

onBeforeUnmount(() => {
  disconnect()
})

watch(state, (value) => emit('state-change', value))

watch(
  () => [props.wsPath, props.autoplay] as const,
  ([path, autoplay]) => {
    if (autoplay && path) connect()
  },
  { immediate: true },
)
</script>

<template>
  <div class="raw-player">
    <div v-if="showToolbar !== false" class="player-toolbar">
      <div>
        <strong>{{ stateText }}</strong>
        <code v-if="codec">{{ codec }}</code>
      </div>
      <div class="player-actions">
        <button :disabled="state === 'connecting' || state === 'connected' || state === 'decoding'" @click="connect">
          {{ label('播放', 'Play') }}
        </button>
        <button :disabled="state === 'idle' || state === 'closed'" @click="disconnect">
          {{ label('停止', 'Stop') }}
        </button>
      </div>
    </div>
    <div class="canvas-shell">
      <canvas
        ref="canvasRef"
        :class="['video-canvas', { interactive, dragging }]"
        :style="frameSize ? { aspectRatio: `${frameSize.width} / ${frameSize.height}` } : undefined"
        @pointerdown="handleCanvasPointerDown"
        @pointermove="handleCanvasPointerMove"
        @pointerup="handleCanvasPointerUp"
        @pointercancel="handleCanvasPointerCancel"
      />
    </div>
    <div class="player-stats">
      <span>{{ label('字节', 'Bytes') }} {{ bytesReceived.toLocaleString() }}</span>
      <span>{{ label('帧', 'Frames') }} {{ framesDecoded.toLocaleString() }}</span>
      <span v-if="message">{{ message }}</span>
    </div>
  </div>
</template>

<style scoped>
.raw-player {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
  padding: 10px;
  border: 1px solid #bfdbfe;
  border-radius: 8px;
  background: #f8fbff;
}

.canvas-shell {
  display: flex;
  min-height: 0;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #020617;
}

.player-toolbar,
.player-actions,
.player-stats {
  display: flex;
  align-items: center;
  gap: 8px;
}

.player-toolbar {
  justify-content: space-between;
}

.player-toolbar strong {
  display: block;
  color: #0f172a;
  font-size: 13px;
}

code {
  color: #475569;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 12px;
}

button {
  border: 1px solid #cbd5e1;
  border-radius: 6px;
  background: #fff;
  color: #334155;
  padding: 6px 9px;
  font: inherit;
  font-size: 12px;
  font-weight: 800;
  cursor: pointer;
}

button:hover:not(:disabled) {
  border-color: #2563eb;
  color: #1d4ed8;
  background: #eff6ff;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.video-canvas {
  display: block;
  width: auto;
  max-width: 100%;
  height: auto;
  max-height: calc(100dvh - 180px);
  min-height: 180px;
  border: 0;
  background: #020617;
}

.video-canvas.interactive {
  cursor: crosshair;
  touch-action: none;
  user-select: none;
}

.video-canvas.dragging {
  cursor: grabbing;
}

.player-stats {
  flex-wrap: wrap;
  color: #475569;
  font-size: 12px;
  font-weight: 800;
}
</style>
