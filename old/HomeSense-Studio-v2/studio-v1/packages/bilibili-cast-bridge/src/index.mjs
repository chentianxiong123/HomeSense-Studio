import { pathToFileURL } from 'node:url'

const DEFAULT_BASE_URL = 'http://127.0.0.1:28974'
const PUBLIC_ACTIONS = [
  'health',
  'search_bilibili',
  'resolve_audio',
  'discover_devices',
  'sniff_media',
  'resolve_play_url',
  'start_cast',
  'control_cast',
  'cast_status',
  'service_status',
  'list_speakers',
  'play_bilibili',
  'control_playback',
  'get_volume',
  'set_volume',
]

const ACTION_ALIASES = {
  search_bilibili: 'music_search',
  resolve_audio: 'music_audio',
  discover_devices: 'cast_devices',
  sniff_media: 'cast_sniff',
  resolve_play_url: 'cast_play_url',
  start_cast: 'cast_start',
  control_cast: 'cast_control',
  service_status: 'speaker_status',
  list_speakers: 'speaker_devices',
  play_bilibili: 'speaker_play',
  control_playback: 'speaker_control',
  get_volume: 'speaker_volume',
  set_volume: 'speaker_volume',

  // Backward-compatible aliases. These are not exposed in current manifests.
  music_search: 'music_search',
  music_audio: 'music_audio',
  cast_devices: 'cast_devices',
  cast_sniff: 'cast_sniff',
  cast_play_url: 'cast_play_url',
  cast_start: 'cast_start',
  cast_control: 'cast_control',
  speaker_status: 'speaker_status',
  speaker_devices: 'speaker_devices',
  speaker_play: 'speaker_play',
  speaker_control: 'speaker_control',
  speaker_volume: 'speaker_volume',
}

export async function run(input = {}) {
  const publicAction = String(input.action ?? '')
  const action = ACTION_ALIASES[publicAction] ?? publicAction

  try {
    switch (action) {
      case 'health':
        return await health(input)
      case 'music_search':
        return await get('/api/v1/music/search', input, {
          keyword: requiredString(input.keyword, 'keyword'),
          page: input.page ?? 1,
          page_size: input.page_size ?? 20,
        })
      case 'music_audio':
        return await get(`/api/v1/music/audio/${encodeURIComponent(requiredString(input.bvid, 'bvid'))}`, input, {
          quality: input.quality,
        })
      case 'cast_devices':
        return await get('/api/v1/cast/devices', input, {
          target_ip: input.target_ip,
        })
      case 'cast_sniff':
        return await post('/api/v1/cast/sniff', input, {
          url: requiredString(input.url, 'url'),
        })
      case 'cast_play_url':
        return await post('/api/v1/cast/play_url', input, {
          url: requiredString(input.url, 'url'),
          title: String(input.title ?? 'Video'),
        })
      case 'cast_start':
        return await post('/api/v1/cast/start', input, {
          episode_url: requiredString(input.episode_url, 'episode_url'),
          device_udn: requiredString(input.device_udn, 'device_udn'),
          title: String(input.title ?? 'Video'),
        })
      case 'cast_control':
        return await post('/api/v1/cast/control', input, {
          device_udn: requiredString(input.device_udn, 'device_udn'),
          action: requiredString(input.control_action ?? input.cast_action, 'control_action'),
          target: optionalString(input.target),
          volume: optionalNumber(input.volume),
        })
      case 'cast_status':
        return await get(`/api/v1/cast/status/${encodeURIComponent(requiredString(input.device_udn, 'device_udn'))}`, input)
      case 'speaker_status':
        return await get('/api/v1/speaker/status', input)
      case 'speaker_devices':
        return await get('/api/v1/speaker/devices', input)
      case 'speaker_play':
        return await post('/api/v1/speaker/play', input, {
          bvid: requiredString(input.bvid, 'bvid'),
          did: requiredString(input.did, 'did'),
          quality: input.quality,
        })
      case 'speaker_control':
        return await post('/api/v1/speaker/control', input, {
          did: requiredString(input.did, 'did'),
          action: String(input.control_action ?? 'pause'),
          volume: optionalNumber(input.volume),
        })
      case 'speaker_volume':
        if (input.volume == null) {
          return await get(`/api/v1/speaker/volume/${encodeURIComponent(requiredString(input.did, 'did'))}`, input)
        }
        return await post('/api/v1/speaker/volume', input, {
          did: requiredString(input.did, 'did'),
          volume: optionalNumber(input.volume),
        })
      default:
        return fail('ACTION_NOT_FOUND', `unsupported action: ${publicAction}`)
    }
  } catch (err) {
    if (err instanceof InputError) return fail('INVALID_PARAMS', err.message)
    return fail('CAST_BRIDGE_ERROR', err instanceof Error ? err.message : String(err))
  }
}

async function health(input) {
  const base_url = baseUrl(input)
  const probe = await request('/health', { base_url, method: 'GET', tolerateUnavailable: true })
  return respond({
    ready: true,
    adapter: 'bilibili_music',
    base_url,
    service_reachable: probe.status === 'success',
    service_health: probe.status === 'success' ? probe.data : null,
    error: probe.status === 'error' ? { code: probe.error, message: probe.message } : null,
    supported_actions: PUBLIC_ACTIONS,
  })
}

async function get(pathname, input = {}, query = {}) {
  return request(pathname, {
    method: 'GET',
    query,
    base_url: input.base_url,
    timeout_ms: input.timeout_ms,
  })
}

async function post(pathname, input = {}, body = {}) {
  return request(pathname, {
    method: 'POST',
    body,
    base_url: input.base_url,
    timeout_ms: input.timeout_ms,
  })
}

async function request(pathname, options = {}) {
  const base_url = baseUrl(options)
  const url = new URL(pathname, `${base_url}/`)
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value))
    }
  }

  const controller = new AbortController()
  const timeoutMs = Number(
    options.timeout_ms
    ?? process.env.CAST_BRIDGE_TIMEOUT_MS
    ?? process.env.BILIBILI_MUSIC_TIMEOUT_MS
    ?? 15000,
  )
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      body: options.body ? JSON.stringify(stripUndefined(options.body)) : undefined,
      signal: controller.signal,
    })
    const text = await response.text()
    const parsed = parseMaybeJson(text)
    if (!response.ok) {
      return fail('CAST_SERVICE_HTTP_ERROR', `bilibili-music HTTP ${response.status}`, {
        status_code: response.status,
        body: parsed,
        url: url.toString(),
      })
    }
    return normalizeCastServiceResult(parsed, url.toString())
  } catch (err) {
    if (options.tolerateUnavailable) {
      return fail('CAST_SERVICE_UNAVAILABLE', err instanceof Error ? err.message : String(err))
    }
    return fail('CAST_SERVICE_UNAVAILABLE', `bilibili-music service is not reachable at ${base_url}: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    clearTimeout(timeout)
  }
}

function normalizeCastServiceResult(payload, url) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'code' in payload) {
    const code = Number(payload.code)
    if (code === 0 || code === 200) {
      return respond({
        code,
        message: payload.message ?? 'success',
        data: payload.data ?? null,
        raw: payload,
        source_url: url,
      })
    }
    return fail(`CAST_SERVICE_CODE_${code}`, String(payload.message ?? 'bilibili-music returned an error'), {
      code,
      data: payload.data ?? null,
      raw: payload,
      source_url: url,
    })
  }

  return respond({
    data: payload,
    source_url: url,
  })
}

function baseUrl(input = {}) {
  return String(
    input.base_url
    ?? process.env.HOMESENSE_BILIBILI_MUSIC_BASE_URL
    ?? process.env.BILIBILI_MUSIC_BASE_URL
    ?? process.env.HOMESENSE_CAST_BASE_URL
    ?? process.env.CAST_SERVICE_BASE_URL
    ?? DEFAULT_BASE_URL,
  ).replace(/\/+$/, '')
}

function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined))
}

function parseMaybeJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function requiredString(value, key) {
  const text = String(value ?? '').trim()
  if (!text) throw new InputError(`${key} is required`)
  return text
}

function optionalString(value) {
  if (value == null || value === '') return undefined
  return String(value)
}

function optionalNumber(value) {
  if (value == null || value === '') return undefined
  const number = Number(value)
  if (!Number.isFinite(number)) throw new InputError('number expected')
  return number
}

class InputError extends Error {}

function respond(data) {
  return { status: 'success', data }
}

function fail(error, message, data) {
  return data === undefined
    ? { status: 'error', error, message }
    : { status: 'error', error, message, data }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, rawPayload] = process.argv.slice(2)
  const payload = rawPayload ? JSON.parse(rawPayload) : {}
  const input = command === 'run'
    ? payload
    : { action: command, ...payload }
  const result = await run(input)
  process.stdout.write(JSON.stringify(result))
}
