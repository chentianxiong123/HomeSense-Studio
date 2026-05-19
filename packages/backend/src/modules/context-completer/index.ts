export interface ContextCompleterInput {
  message: string
  history?: Array<{ role: string; content: string }>
  working_context?: Record<string, unknown>
}

export interface DeviceWeight {
  device_id: string
  label: string
  type: 'tv' | 'speaker' | 'stb' | 'hub'
  score: number
}

export interface ContextCompletionResult {
  original_message: string
  completed_message: string
  target_device_id?: string
  target_device_label?: string
  target_device_type?: 'tv' | 'speaker' | 'stb' | 'hub'
  matched_media_app?: 'bilibili'
  device_weights: DeviceWeight[]
}

interface DevicePattern {
  device_id: string
  label: string
  type: 'tv' | 'speaker' | 'stb' | 'hub'
  keywords: string[]
}

const DEVICE_PATTERNS: DevicePattern[] = [
  { device_id: 'toshiba_tv', label: '东芝电视', type: 'tv', keywords: ['东芝', 'toshiba', '东芝电视'] },
  { device_id: 'letv_tv', label: '乐视电视', type: 'tv', keywords: ['乐视', 'letv', '乐视电视'] },
  { device_id: 'stb', label: '机顶盒', type: 'stb', keywords: ['机顶盒', '盒子', 'stb'] },
  { device_id: 'xiaoai_ir_hub', label: '小爱红外音箱', type: 'hub', keywords: ['小爱', '小爱红外', '红外音箱'] },
  { device_id: 'redmi_xiaoai_speaker', label: '红米小爱音箱', type: 'speaker', keywords: ['红米小爱', '小爱音箱', 'speaker'] },
]

const PRONOUNS = ['它', '那个', '这个', '那台', '这台']
const BILIBILI_ALIASES = ['bilibili', 'bili', 'b站', '哔哩哔哩', '小电视']
const WORKFLOW_HINTS = ['workflow', 'studio', 'graph', 'node', 'orchestrate', 'automation', '工作流', '编排', '节点', '流程']
const TV_ACTION_HINTS = ['watch', 'open', 'launch', 'play', '打开', '看', '播放', '启动']

class ContextCompleterService {
  complete(input: ContextCompleterInput): ContextCompletionResult {
    const message = input.message.trim()
    const normalizedMessage = normalizeText(message)
    const historyTexts = (input.history ?? [])
      .filter((item) => item.role === 'user')
      .map((item) => item.content)
      .slice(-10)

    const scoredDevices = scoreDevices(message, historyTexts, input.working_context)
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
    })
    completedMessage = this.applyTriggerRules({
      message: completedMessage,
      target,
      matchedMediaApp,
      workflowIntent,
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
  }): DeviceWeight | undefined {
    const normalizedMessage = normalizeText(params.message)
    const explicit = params.scoredDevices.find((device) => {
      const pattern = DEVICE_PATTERNS.find((item) => item.device_id === device.device_id)
      return (pattern?.keywords ?? []).some((keyword) => normalizedMessage.includes(normalizeText(keyword)))
    })
    if (explicit) return explicit

    if (params.workflowIntent) {
      return explicit
    }

    if (params.matchedMediaApp) {
      const rememberedTv = typeof params.workingContext?.preferred_tv_device_id === 'string'
        ? params.scoredDevices.find((device) => device.device_id === params.workingContext?.preferred_tv_device_id)
        : undefined
      if (rememberedTv) return rememberedTv

      const toshiba = params.scoredDevices.find((device) => device.device_id === 'toshiba_tv')
      if (toshiba) return toshiba

      const tv = params.scoredDevices.find((device) => device.type === 'tv')
      if (tv) return tv

      return {
        device_id: 'toshiba_tv',
        label: '东芝电视',
        type: 'tv',
        score: 1,
      }
    }

    return params.scoredDevices[0]
  }

  private applyTriggerRules(params: {
    message: string
    target: DeviceWeight | undefined
    matchedMediaApp?: 'bilibili'
    workflowIntent: boolean
  }): string {
    if (!params.target) return params.message
    if (params.workflowIntent) return params.message

    const normalizedMessage = normalizeText(params.message)
    const hasDeviceName = DEVICE_PATTERNS.some((device) =>
      device.keywords.some((keyword) => normalizedMessage.includes(normalizeText(keyword))),
    )

    if (params.matchedMediaApp && !hasDeviceName && hasTvActionIntent(params.message)) {
      return `在${params.target.label}上看B站`
    }

    if (!hasDeviceName && hasTvActionIntent(params.message) && params.target.type === 'tv') {
      return `在${params.target.label}上${params.message}`
    }

    return params.message
  }
}

function scoreDevices(
  currentMessage: string,
  historyTexts: string[],
  workingContext?: Record<string, unknown>,
): DeviceWeight[] {
  const scores = new Map<string, DeviceWeight>()
  const combinedTexts = [...historyTexts, currentMessage]

  for (let index = 0; index < combinedTexts.length; index += 1) {
    const text = combinedTexts[index]
    const isCurrentMessage = index === combinedTexts.length - 1
    const weight = isCurrentMessage ? 1 : Math.pow(0.9, combinedTexts.length - 1 - index)
    const normalizedText = normalizeText(text)

    for (const device of DEVICE_PATTERNS) {
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

  const preferredTv = typeof workingContext?.preferred_tv_device_id === 'string'
    ? workingContext.preferred_tv_device_id
    : null
  if (preferredTv && scores.has(preferredTv)) {
    const item = scores.get(preferredTv)!
    item.score += 0.5
    scores.set(preferredTv, item)
  }

  if (!scores.has('toshiba_tv')) {
    scores.set('toshiba_tv', {
      device_id: 'toshiba_tv',
      label: '东芝电视',
      type: 'tv',
      score: preferredTv === 'toshiba_tv' ? 0.6 : 0.2,
    })
  }

  return Array.from(scores.values()).sort((left, right) => right.score - left.score)
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

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

export const contextCompleter = new ContextCompleterService()

