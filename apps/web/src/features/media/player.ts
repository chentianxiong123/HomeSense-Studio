import { computed, reactive, readonly } from 'vue'
import { mediaApi } from '@/api/media'
import type { MediaItem, MediaOutput, MediaPlayMode, MediaSession } from './types'

const VOLUME_STORAGE_KEY = 'homesense.media.volume'
const MODE_STORAGE_KEY = 'homesense.media.playMode'

const browserOutput: MediaOutput = {
  id: 'browser:local',
  kind: 'browser',
  name: 'Browser',
  online: true,
}

const state = reactive({
  queue: [] as MediaItem[],
  currentIndex: -1,
  playMode: readInitialPlayMode(),
  session: {
    id: 'browser-session',
    item: null,
    output: browserOutput,
    state: 'idle',
    position_sec: 0,
    duration_sec: 0,
    volume: readInitialVolume(),
  } as MediaSession,
})

let audioElement: HTMLAudioElement | null = null

const currentItem = computed(() => {
  if (state.currentIndex < 0) return null
  return state.queue[state.currentIndex] ?? null
})

const progress = computed(() => {
  const duration = state.session.duration_sec || state.session.item?.duration_sec || 0
  if (!duration) return 0
  return Math.min(100, Math.max(0, (state.session.position_sec / duration) * 100))
})

const hasNext = computed(() => {
  if (state.currentIndex < 0 || state.queue.length <= 1) return false
  if (state.playMode === 'loop' || state.playMode === 'random') return true
  return state.currentIndex < state.queue.length - 1
})
const hasPrevious = computed(() => {
  if (state.currentIndex < 0 || state.queue.length <= 1) return false
  if (state.playMode === 'loop' || state.playMode === 'random') return true
  return state.currentIndex > 0
})
const canControl = computed(() => Boolean(state.session.item))

export function useMediaPlayer() {
  return {
    state: readonly(state),
    queue: computed(() => state.queue),
    currentItem,
    progress,
    hasNext,
    hasPrevious,
    canControl,
    addToQueue,
    clearQueue,
    hydrateQueue,
    pause,
    playAtIndex,
    playDirectUrl,
    playItem,
    removeFromQueue,
    reorderQueue,
    seekToPercent,
    selectOutput,
    setPlayMode,
    setVolume,
    stop,
    toggle,
    next,
    previous,
  }
}

export async function playDirectUrl(input: { url: string; title?: string; artist?: string }) {
  const url = input.url.trim()
  if (!url) return
  const item: MediaItem = {
    id: `url:${url}`,
    source: 'url',
    title: input.title?.trim() || titleFromUrl(url),
    artist: input.artist?.trim() || 'URL',
    upstream_url: url,
    stream_url: url,
  }
  await playItem(item)
}

export async function playItem(item: MediaItem) {
  const existingIndex = state.queue.findIndex((queued) => queued.id === item.id)
  if (existingIndex >= 0) {
    state.queue[existingIndex] = { ...state.queue[existingIndex], ...item }
    state.currentIndex = existingIndex
  } else {
    state.queue.push(item)
    state.currentIndex = state.queue.length - 1
  }
  await startPlayback(item)
}

export function addToQueue(item: MediaItem | MediaItem[]) {
  const items = Array.isArray(item) ? item : [item]
  const ids = new Set(state.queue.map((queued) => queued.id))
  for (const nextItem of items) {
    if (ids.has(nextItem.id)) continue
    state.queue.push(nextItem)
    ids.add(nextItem.id)
  }
}

export function hydrateQueue(items: MediaItem[]) {
  const nextQueue: MediaItem[] = []
  const ids = new Set<string>()
  for (const item of items) {
    if (!item.id || ids.has(item.id)) continue
    nextQueue.push(item)
    ids.add(item.id)
  }
  const activeId = state.session.item?.id
  state.queue = nextQueue
  state.currentIndex = activeId ? nextQueue.findIndex((item) => item.id === activeId) : -1
}

export async function playAtIndex(index: number) {
  const item = state.queue[index]
  if (!item) return
  state.currentIndex = index
  await startPlayback(item)
}

export function removeFromQueue(index: number) {
  if (index < 0 || index >= state.queue.length) return
  const removingCurrent = index === state.currentIndex
  state.queue.splice(index, 1)
  if (state.queue.length === 0) {
    stop()
    state.currentIndex = -1
    state.session.item = null
    return
  }
  if (index < state.currentIndex) state.currentIndex -= 1
  if (removingCurrent) {
    state.currentIndex = Math.min(index, state.queue.length - 1)
    void playAtIndex(state.currentIndex)
  }
}

export function reorderQueue(fromIndex: number, toIndex: number) {
  if (fromIndex < 0 || fromIndex >= state.queue.length) return
  if (toIndex < 0 || toIndex >= state.queue.length) return
  if (fromIndex === toIndex) return

  const activeId = currentItem.value?.id
  const [item] = state.queue.splice(fromIndex, 1)
  if (!item) return
  state.queue.splice(toIndex, 0, item)
  state.currentIndex = activeId ? state.queue.findIndex((queued) => queued.id === activeId) : -1
}

export function clearQueue() {
  stop()
  state.queue = []
  state.currentIndex = -1
  state.session.item = null
  state.session.position_sec = 0
  state.session.duration_sec = 0
}

export async function toggle() {
  if (state.session.output.kind !== 'browser') {
    if (!state.session.item) return
    if (state.session.state === 'playing') {
      pause()
      return
    }
    if (state.session.state === 'paused') {
      await resumeRemote()
      return
    }
    await startRemotePlayback(state.session.item, state.session.output)
    return
  }
  const audio = ensureAudioElement()
  if (!audio || !state.session.item) return
  if (state.session.state === 'playing') {
    pause()
    return
  }
  try {
    state.session.state = 'loading'
    await audio.play()
    state.session.state = 'playing'
    state.session.error = ''
  } catch (error) {
    state.session.state = 'error'
    state.session.error = error instanceof Error ? error.message : String(error)
  }
}

export function pause() {
  if (state.session.output.kind !== 'browser') {
    void controlRemote('pause')
    if (state.session.item) state.session.state = 'paused'
    return
  }
  if (audioElement) audioElement.pause()
  if (state.session.item) state.session.state = 'paused'
}

export function stop() {
  if (state.session.output.kind !== 'browser') {
    void controlRemote('stop')
    state.session.state = 'stopped'
    state.session.position_sec = 0
    return
  }
  if (audioElement) {
    audioElement.pause()
    audioElement.removeAttribute('src')
    audioElement.load()
  }
  state.session.state = 'stopped'
  state.session.position_sec = 0
}

export async function next() {
  const nextIndex = resolveNextIndex(false)
  if (nextIndex == null) return
  await playAtIndex(nextIndex)
}

export async function previous() {
  const previousIndex = resolvePreviousIndex()
  if (previousIndex == null) return
  await playAtIndex(previousIndex)
}

export function seekToPercent(value: number) {
  const audio = ensureAudioElement()
  const duration = state.session.duration_sec || audio?.duration || 0
  if (!audio || !Number.isFinite(duration) || duration <= 0) return
  const nextTime = (Math.min(100, Math.max(0, value)) / 100) * duration
  audio.currentTime = nextTime
  state.session.position_sec = nextTime
}

export function setVolume(volume: number) {
  const nextVolume = Math.min(100, Math.max(0, Math.round(volume)))
  state.session.volume = nextVolume
  if (state.session.output.kind === 'browser') {
    if (audioElement) audioElement.volume = nextVolume / 100
  } else {
    void controlRemote('volume', nextVolume)
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(VOLUME_STORAGE_KEY, String(nextVolume))
  }
}

export function selectOutput(output: MediaOutput) {
  state.session.output = output
}

export function setPlayMode(mode: MediaPlayMode) {
  state.playMode = mode
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(MODE_STORAGE_KEY, mode)
  }
}

async function startPlayback(item: MediaItem) {
  if (state.session.output.kind !== 'browser') {
    await startRemotePlayback(item, state.session.output)
    return
  }
  await startBrowserPlayback(item)
}

async function startBrowserPlayback(item: MediaItem) {
  const streamUrl = item.stream_url || item.upstream_url
  if (!streamUrl) {
    state.session.item = item
    state.session.state = 'error'
    state.session.error = 'MEDIA_STREAM_MISSING'
    return
  }

  const audio = ensureAudioElement()
  if (!audio) return

  state.session.item = item
  state.session.output = browserOutput
  state.session.position_sec = 0
  state.session.duration_sec = item.duration_sec || 0
  state.session.state = 'loading'
  state.session.error = ''

  try {
    if (audio.src !== streamUrl) {
      audio.src = streamUrl
      audio.load()
    }
    await audio.play()
    state.session.state = 'playing'
  } catch (error) {
    state.session.state = 'error'
    state.session.error = error instanceof Error ? error.message : String(error)
  }
}

async function startRemotePlayback(item: MediaItem, output: MediaOutput) {
  if (audioElement) audioElement.pause()
  state.session.item = item
  state.session.position_sec = 0
  state.session.duration_sec = item.duration_sec || 0
  state.session.state = 'loading'
  state.session.error = ''

  try {
    let result: { status: 'success' | 'error'; error?: string; message?: string }
    if (output.kind === 'xiaoai') {
      if (!output.endpoint || !item.upstream_id) {
        throw new Error('XiaoAi output requires a Bilibili item')
      }
      result = await mediaApi.playBilibiliOnXiaoAi({
        did: output.endpoint,
        bvid: item.upstream_id,
        title: item.title,
      })
    } else if (output.kind === 'dlna') {
      if (!output.endpoint) throw new Error('DLNA output endpoint is missing')
      const streamUrl = item.stream_url || item.upstream_url || ''
      result = streamUrl
        ? await mediaApi.playUrlOnDlna({
          location: output.endpoint,
          url: streamUrl,
          title: item.title,
          content_type: item.mime_type || contentTypeFromUrl(streamUrl),
        })
        : await mediaApi.playBilibiliOnDlna({
          location: output.endpoint,
          bvid: item.upstream_id || '',
          title: item.title,
        })
    } else {
      throw new Error(`Unsupported output: ${output.kind}`)
    }

    if (result.status !== 'success') {
      throw new Error(result.message || result.error || 'MEDIA_OUTPUT_PUSH_FAILED')
    }
    state.session.state = 'playing'
  } catch (error) {
    state.session.state = 'error'
    state.session.error = error instanceof Error ? error.message : String(error)
  }
}

async function controlRemote(control: 'pause' | 'resume' | 'stop' | 'volume', volume?: number) {
  const output = state.session.output
  if (!output.endpoint) return
  try {
    const result = output.kind === 'xiaoai'
      ? await mediaApi.controlXiaoAi(output.endpoint, control, volume)
      : output.kind === 'dlna'
        ? await mediaApi.controlDlna(output.endpoint, control, volume)
        : null
    if (result && result.status !== 'success') {
      state.session.error = result.message || result.error || 'MEDIA_OUTPUT_CONTROL_FAILED'
    }
  } catch (error) {
    state.session.error = error instanceof Error ? error.message : String(error)
  }
}

async function resumeRemote() {
  if (!state.session.item) return
  state.session.state = 'loading'
  state.session.error = ''
  await controlRemote('resume')
  if (state.session.error) {
    await startRemotePlayback(state.session.item, state.session.output)
    return
  }
  state.session.state = 'playing'
}

function ensureAudioElement(): HTMLAudioElement | null {
  if (typeof Audio === 'undefined') return null
  if (audioElement) return audioElement

  const audio = new Audio()
  audio.preload = 'metadata'
  audio.volume = state.session.volume / 100

  audio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(audio.duration)) {
      state.session.duration_sec = audio.duration
    }
  })
  audio.addEventListener('timeupdate', () => {
    state.session.position_sec = audio.currentTime || 0
  })
  audio.addEventListener('playing', () => {
    state.session.state = 'playing'
    state.session.error = ''
  })
  audio.addEventListener('pause', () => {
    if (state.session.state === 'playing') state.session.state = 'paused'
  })
  audio.addEventListener('ended', () => {
    const nextIndex = resolveNextIndex(true)
    if (nextIndex != null) {
      void playAtIndex(nextIndex)
      return
    }
    state.session.state = 'stopped'
    state.session.position_sec = 0
  })
  audio.addEventListener('error', () => {
    state.session.state = 'error'
    state.session.error = audio.error?.message || 'MEDIA_PLAYBACK_ERROR'
  })

  audioElement = audio
  return audio
}

function readInitialVolume(): number {
  if (typeof window === 'undefined') return 80
  const saved = Number(window.localStorage.getItem(VOLUME_STORAGE_KEY))
  return Number.isFinite(saved) ? Math.min(100, Math.max(0, saved)) : 80
}

function readInitialPlayMode(): MediaPlayMode {
  if (typeof window === 'undefined') return 'loop'
  const saved = window.localStorage.getItem(MODE_STORAGE_KEY)
  return isPlayMode(saved) ? saved : 'loop'
}

function isPlayMode(value: unknown): value is MediaPlayMode {
  return value === 'order' || value === 'loop' || value === 'single' || value === 'random'
}

function resolveNextIndex(fromEnded: boolean): number | null {
  if (state.currentIndex < 0 || state.queue.length === 0) return null
  if (state.playMode === 'single') return fromEnded ? state.currentIndex : boundedIndex(state.currentIndex + 1)
  if (state.playMode === 'random') return randomQueueIndex()
  if (state.currentIndex < state.queue.length - 1) return state.currentIndex + 1
  return state.playMode === 'loop' ? 0 : null
}

function resolvePreviousIndex(): number | null {
  if (state.currentIndex < 0 || state.queue.length === 0) return null
  if (state.playMode === 'random') return randomQueueIndex()
  if (state.currentIndex > 0) return state.currentIndex - 1
  return state.playMode === 'loop' ? state.queue.length - 1 : null
}

function boundedIndex(index: number): number | null {
  return index >= 0 && index < state.queue.length ? index : null
}

function randomQueueIndex(): number | null {
  if (state.queue.length === 0) return null
  if (state.queue.length === 1) return 0
  let nextIndex = state.currentIndex
  while (nextIndex === state.currentIndex) {
    nextIndex = Math.floor(Math.random() * state.queue.length)
  }
  return nextIndex
}

function titleFromUrl(url: string): string {
  try {
    const parsed = new URL(url)
    const lastPart = parsed.pathname.split('/').filter(Boolean).at(-1)
    return decodeURIComponent(lastPart || parsed.hostname)
  } catch {
    return url
  }
}

function contentTypeFromUrl(url: string): string {
  const pathname = url.split('?', 1)[0]?.toLowerCase() || ''
  if (pathname.endsWith('.mp3')) return 'audio/mpeg'
  if (pathname.endsWith('.m4a')) return 'audio/mp4'
  if (pathname.endsWith('.aac')) return 'audio/aac'
  if (pathname.endsWith('.flac')) return 'audio/flac'
  if (pathname.endsWith('.wav')) return 'audio/wav'
  if (pathname.endsWith('.ogg')) return 'audio/ogg'
  if (pathname.endsWith('.webm')) return 'video/webm'
  if (pathname.endsWith('.mkv')) return 'video/x-matroska'
  if (pathname.endsWith('.mov')) return 'video/quicktime'
  if (pathname.endsWith('.avi')) return 'video/x-msvideo'
  if (pathname.endsWith('.flv')) return 'video/x-flv'
  if (pathname.endsWith('.ts')) return 'video/mp2t'
  if (pathname.endsWith('.m3u8')) return 'application/vnd.apple.mpegurl'
  if (pathname.endsWith('.mpd')) return 'application/dash+xml'
  return 'video/mp4'
}
