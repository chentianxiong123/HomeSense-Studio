import { createHash } from 'crypto'
import type { ContextCompletionResult } from './context-completer.js'

export interface IntentFingerprint {
  key: string
  device_id?: string
  capability_id?: string
  app?: string
  workflow_id?: string
}

export function buildFingerprintFromSteps(steps: Array<{ tool: string; action: string; params?: Record<string, unknown> }>): string {
  const parts: string[] = []

  for (const step of steps) {
    const tool = step.tool.trim()
    const action = step.action.trim()
    const params = step.params ?? {}

    if (tool === 'device_agent' && action === 'execute_device_capability') {
      const deviceId = String(params.device_id ?? '*')
      const capabilityId = String(params.capability_id ?? params.capability ?? '*')
      const args = params.arguments as Record<string, unknown> | undefined
      const argKey = args ? stableArgHash(args) : ''
      parts.push(`cap:${deviceId}:${capabilityId}${argKey ? ':' + argKey : ''}`)
    } else if (tool === 'adb-cli' || tool === 'adb') {
      const deviceId = String(params.device_id ?? params.ip ?? '*')
      const pkg = String(params.package ?? params.package_name ?? '')
      parts.push(`adb:${deviceId}:${action}${pkg ? ':' + pkg : ''}`)
    } else if (tool === 'mi-cli') {
      const did = String(params.did ?? params.device_id ?? '*')
      parts.push(`mi:${did}:${action}`)
    } else if (tool === 'workflow' && action === 'run_workflow') {
      const wfId = String(params.workflow_id ?? params.workflow_name ?? '*')
      parts.push(`wf:${wfId}`)
    } else {
      parts.push(`${tool}:${action}`)
    }
  }

  return parts.join('|')
}

export function buildFingerprintFromCompletion(completion: ContextCompletionResult, message: string): string | null {
  const deviceId = completion.target_device_id
  if (!deviceId) return null

  const parts: string[] = []
  const app = completion.matched_media_app

  if (app) {
    parts.push(`cap:${deviceId}:adb.launch_app:${app}`)
  } else {
    const action = extractActionVerb(message)
    if (action) {
      parts.push(`cap:${deviceId}:${action}`)
    } else {
      return null
    }
  }

  return parts.join('|')
}

export function fingerprintMatchScore(queryFp: string, storedFp: string): number {
  if (queryFp === storedFp) return 1.0

  const queryParts = queryFp.split('|')
  const storedParts = storedFp.split('|')

  if (queryParts.length === 0 || storedParts.length === 0) return 0

  let matched = 0
  for (const qp of queryParts) {
    const qSegments = qp.split(':')
    for (const sp of storedParts) {
      const sSegments = sp.split(':')
      if (qSegments[0] !== sSegments[0]) continue
      if (fuzzySegmentMatch(qSegments, sSegments)) {
        matched++
        break
      }
    }
  }

  const coverage = matched / Math.max(queryParts.length, storedParts.length)
  return coverage
}

function fuzzySegmentMatch(query: string[], stored: string[]): boolean {
  for (let i = 0; i < Math.min(query.length, stored.length); i++) {
    if (query[i] === '*' || stored[i] === '*') continue
    if (query[i] !== stored[i]) return false
  }
  return true
}

function stableArgHash(args: Record<string, unknown>): string {
  const sorted = Object.keys(args).sort()
  const significant = sorted
    .filter((k) => args[k] !== undefined && args[k] !== null && args[k] !== '')
    .map((k) => `${k}=${String(args[k])}`)
    .join('&')
  if (!significant) return ''
  return createHash('md5').update(significant).digest('hex').slice(0, 8)
}

function extractActionVerb(message: string): string | null {
  const text = message.trim().toLowerCase()
  const patterns: Array<[RegExp, string]> = [
    [/(?:打开|开启|启动|launch|open|start)/, 'power_on'],
    [/(?:关闭|关掉|关机|关|turn\s*off|shutdown)/, 'power_off'],
    [/(?:播放|放|play)/, 'adb.launch_app'],
    [/(?:音量|声音|volume).*(?:大|up|加|调大)/, 'volume_up'],
    [/(?:音量|声音|volume).*(?:小|down|减|调小)/, 'volume_down'],
    [/(?:暂停|pause)/, 'pause'],
    [/(?:返回|back)/, 'back'],
    [/(?:主页|home|桌面)/, 'home'],
    [/(?:确认|确定|ok|enter|select)/, 'confirm'],
  ]

  for (const [regex, verb] of patterns) {
    if (regex.test(text)) return verb
  }
  return null
}
