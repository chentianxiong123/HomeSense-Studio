import { getDb } from '../../db/index.js'
import type Database from 'better-sqlite3'

export interface ContextCompleterInput {
  message: string
  history?: Array<{ role: string; content: string }>
  working_context?: Record<string, unknown>
}

export interface DeviceWeight {
  device_id: string
  label: string
  type: string
  score: number
}

export interface ContextCompletionResult {
  original_message: string
  completed_message: string
  target_device_id?: string
  target_device_label?: string
  target_device_type?: string
  matched_media_app?: 'bilibili'
  device_weights: DeviceWeight[]
}

interface DeviceCandidate {
  device_id: string
  label: string
  type: string
  keywords: string[]
  score_bias: number
}

interface DeviceRow {
  id: number
  name: string
  device_type: string
  room_name?: string | null
}

const PRONOUNS = ['它', '那个', '这个', '那台', '这台']
const BILIBILI_ALIASES = ['bilibili', 'bili', 'b站', '哔哩哔哩', '小电视']
const WORKFLOW_HINTS = ['workflow', 'studio', 'graph', 'node', 'orchestrate', 'automation', '工作流', '编排', '节点', '流程']
const TV_ACTION_HINTS = ['watch', 'open', 'launch', 'play', '打开', '看', '播放', '启动']

export class ContextCompleterService {
  constructor(private readonly dbProvider: () => Database.Database = getDb) {}

  complete(input: ContextCompleterInput): ContextCompletionResult {
    const message = input.message.trim()
    const normalizedMessage = normalizeText(message)
    const historyTexts = (input.history ?? [])
      .filter((item) => item.role === 'user')
      .map((item) => item.content)
      .slice(-10)

    const deviceCatalog = buildDeviceCatalog(input.working_context, this.dbProvider)
    const scoredDevices = scoreDevices(message, historyTexts, input.working_context, deviceCatalog)
    const matchedMediaApp = BILIBILI_ALIASES.some((alias) => normalizedMessage.includes(normalizeText(alias)))
      ? 'bilibili'
      : undefined
    const workflowIntent = isWorkflowIntent(message)

    let completedMessage = message
    if (containsPronoun(message)) {
      const topDevice = scoredDevices[0]
      if (topDevice) {
        completedMessage = replacePronouns(completedMessage, topDevice.label)
      }
    }

    const target = this.selectTargetDevice({
      message: completedMessage,
      scoredDevices,
      workingContext: input.working_context,
      matchedMediaApp,
      workflowIntent,
      deviceCatalog,
    })
    completedMessage = this.applyTriggerRules({
      message: completedMessage,
      target,
      matchedMediaApp,
      workflowIntent,
      deviceCatalog,
    })

    return {
      original_message: message,
      completed_message: completedMessage,
      target_device_id: target?.device_id,
      target_device_label: target?.label,
      target_device_type: target?.type,
      matched_media_app: matchedMediaApp,
      device_weights: scoredDevices,
    }
  }

  private selectTargetDevice(params: {
    message: string
    scoredDevices: DeviceWeight[]
    workingContext: Record<string, unknown> | undefined
    matchedMediaApp?: 'bilibili'
    workflowIntent: boolean
    deviceCatalog: DeviceCandidate[]
  }): DeviceWeight | undefined {
    const normalizedMessage = normalizeText(params.message)
    const explicit = params.scoredDevices.find((device) => {
      const candidate = params.deviceCatalog.find((item) => item.device_id === device.device_id)
      return (candidate?.keywords ?? []).some((keyword) => normalizedMessage.includes(normalizeText(keyword)))
    })
    if (explicit) return explicit

    if (params.workflowIntent) {
      return explicit
    }

    if (params.matchedMediaApp) {
      const preferredTv = typeof params.workingContext?.preferred_tv_device_id === 'string'
        ? params.scoredDevices.find((device) => device.device_id === params.workingContext?.preferred_tv_device_id)
        : undefined
      if (preferredTv && isTvLike(preferredTv.type)) return preferredTv

      const current = currentContextDevice(params.workingContext, params.scoredDevices)
      if (current && isTvLike(current.type)) return current

      const tv = params.scoredDevices.find((device) => isTvLike(device.type))
      if (tv) return tv

      return undefined
    }

    return params.scoredDevices[0]
  }

  private applyTriggerRules(params: {
    message: string
    target: DeviceWeight | undefined
    matchedMediaApp?: 'bilibili'
    workflowIntent: boolean
    deviceCatalog: DeviceCandidate[]
  }): string {
    if (!params.target) return params.message
    if (params.workflowIntent) return params.message

    const normalizedMessage = normalizeText(params.message)
    const hasDeviceName = params.deviceCatalog.some((device) =>
      device.keywords.some((keyword) => normalizedMessage.includes(normalizeText(keyword))),
    )

    if (params.matchedMediaApp && !hasDeviceName && hasTvActionIntent(params.message)) {
      return `在${params.target.label}上看B站`
    }

    if (!hasDeviceName && hasTvActionIntent(params.message) && isTvLike(params.target.type)) {
      return `在${params.target.label}上${params.message}`
    }

    return params.message
  }
}

function buildDeviceCatalog(
  workingContext: Record<string, unknown> | undefined,
  dbProvider: () => Database.Database,
): DeviceCandidate[] {
  const candidates = new Map<string, DeviceCandidate>()

  const contextDeviceId = readFirstString(
    workingContext?.current_device_id,
    workingContext?.current_device,
    workingContext?.target_device_id,
  )
  const contextDeviceName = readFirstString(workingContext?.current_device_name, workingContext?.target_device_name)
  const contextDeviceType = readFirstString(workingContext?.current_device_type, workingContext?.target_device_type)
  if (contextDeviceId && contextDeviceName) {
    addDeviceCandidate(candidates, {
      device_id: contextDeviceId,
      label: contextDeviceName,
      type: normalizeDeviceType(contextDeviceType),
      keywords: [
        contextDeviceName,
        contextDeviceType,
        String(workingContext?.current_device_room_name ?? ''),
      ],
      score_bias: 0.65,
    })
  }

  for (const row of loadUserDevices(dbProvider)) {
    addDeviceCandidate(candidates, {
      device_id: String(row.id),
      label: row.name,
      type: normalizeDeviceType(row.device_type),
      keywords: [row.name, row.device_type, row.room_name ?? '', ...genericDeviceKeywords(row.device_type)],
      score_bias: 0,
    })
  }

  return Array.from(candidates.values())
}

function addDeviceCandidate(map: Map<string, DeviceCandidate>, candidate: DeviceCandidate): void {
  const keywords = Array.from(new Set([
    candidate.label,
    candidate.type,
    ...candidate.keywords,
    ...genericDeviceKeywords(candidate.type),
  ].map((item) => String(item).trim()).filter(Boolean)))
  const existing = map.get(candidate.device_id)
  map.set(candidate.device_id, {
    device_id: candidate.device_id,
    label: existing?.label || candidate.label,
    type: normalizeDeviceType(existing?.type || candidate.type),
    keywords: Array.from(new Set([...(existing?.keywords ?? []), ...keywords])),
    score_bias: Math.max(existing?.score_bias ?? 0, candidate.score_bias),
  })
}

function loadUserDevices(dbProvider: () => Database.Database): DeviceRow[] {
  try {
    return dbProvider().prepare(`
      SELECT d.id, d.name, d.device_type, r.name AS room_name
      FROM user_devices d
      LEFT JOIN rooms r ON r.id = d.room_id
      ORDER BY d.created_at DESC
      LIMIT 50
    `).all() as DeviceRow[]
  } catch {
    return []
  }
}

function scoreDevices(
  currentMessage: string,
  historyTexts: string[],
  workingContext: Record<string, unknown> | undefined,
  deviceCatalog: DeviceCandidate[],
): DeviceWeight[] {
  const scores = new Map<string, DeviceWeight>()
  const combinedTexts = [...historyTexts, currentMessage]

  for (let index = 0; index < combinedTexts.length; index += 1) {
    const text = combinedTexts[index]
    const isCurrentMessage = index === combinedTexts.length - 1
    const weight = isCurrentMessage ? 1 : Math.pow(0.9, combinedTexts.length - 1 - index)
    const normalizedText = normalizeText(text)

    for (const device of deviceCatalog) {
      const matchCount = device.keywords.filter((keyword) => normalizedText.includes(normalizeText(keyword))).length
      if (matchCount === 0) continue
      const existing = scores.get(device.device_id)
      const nextScore = (existing?.score ?? 0) + (matchCount * weight)
      scores.set(device.device_id, {
        device_id: device.device_id,
        label: device.label,
        type: device.type,
        score: nextScore,
      })
    }
  }

  const currentDevice = currentContextDevice(workingContext, deviceCatalog.map((device) => ({
    device_id: device.device_id,
    label: device.label,
    type: device.type,
    score: 0,
  })))
  if (currentDevice) {
    scores.set(currentDevice.device_id, {
      ...currentDevice,
      score: (scores.get(currentDevice.device_id)?.score ?? 0) + 0.55,
    })
  }

  const preferredTv = typeof workingContext?.preferred_tv_device_id === 'string'
    ? workingContext.preferred_tv_device_id
    : null
  if (preferredTv && scores.has(preferredTv)) {
    const item = scores.get(preferredTv)!
    item.score += 0.5
    scores.set(preferredTv, item)
  }

  for (const device of deviceCatalog) {
    if (scores.has(device.device_id)) continue
    if (device.score_bias <= 0) continue
    scores.set(device.device_id, {
      device_id: device.device_id,
      label: device.label,
      type: device.type,
      score: device.score_bias,
    })
  }

  return Array.from(scores.values()).sort((left, right) => right.score - left.score)
}

function currentContextDevice(
  workingContext: Record<string, unknown> | undefined,
  devices: DeviceWeight[],
): DeviceWeight | undefined {
  const currentId = readFirstString(workingContext?.current_device_id, workingContext?.current_device)
  if (!currentId) return undefined
  return devices.find((device) => device.device_id === currentId)
}

function containsPronoun(message: string): boolean {
  return PRONOUNS.some((pronoun) => message.includes(pronoun))
}

function replacePronouns(message: string, replacement: string): string {
  let output = message
  for (const pronoun of PRONOUNS) {
    output = output.replace(new RegExp(pronoun, 'g'), replacement)
  }
  return output
}

function hasTvActionIntent(message: string): boolean {
  const compact = normalizeText(message)
  return TV_ACTION_HINTS.some((hint) => compact.includes(normalizeText(hint)))
}

function isWorkflowIntent(message: string): boolean {
  const compact = normalizeText(message)
  return WORKFLOW_HINTS.some((hint) => compact.includes(normalizeText(hint)))
}

function isTvLike(type: string): boolean {
  const normalized = normalizeDeviceType(type)
  return ['tv', 'television', 'stb', 'tv_box'].includes(normalized)
}

function normalizeDeviceType(value: string): string {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'television') return 'tv'
  return normalized || 'unknown'
}

function genericDeviceKeywords(type: string): string[] {
  const normalized = normalizeDeviceType(type)
  if (isTvLike(normalized)) return ['电视', 'tv', 'television', '机顶盒', '盒子', 'stb']
  if (normalized === 'speaker') return ['音箱', '小爱', 'speaker']
  if (normalized === 'computer') return ['电脑', 'computer', 'pc']
  if (normalized === 'phone') return ['手机', 'phone']
  if (normalized === 'tablet') return ['平板', 'tablet']
  return []
}

function readFirstString(...values: unknown[]): string {
  for (const value of values) {
    const text = String(value ?? '').trim()
    if (text) return text
  }
  return ''
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

export const contextCompleter = new ContextCompleterService()
