import { Body, Controller, Param, Post } from '@nestjs/common'
import { cliBridge, type CLIResult } from './cli-bridge'

interface PassthroughBody {
  action: string
  params?: Record<string, unknown>
  ttl_ms?: number
  bypass_cache?: boolean
}

interface CacheEntry {
  result: CLIResult
  expiresAt: number
}

const BUILT_IN_CLIS = new Set(['mi-cli', 'adb-cli', 'media-cli'])
const DEFAULT_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 500

const cache = new Map<string, CacheEntry>()

function hashKey(cliName: string, body: PassthroughBody): string {
  const stable = {
    action: body.action,
    params: body.params ? Object.keys(body.params).sort().reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = body.params?.[k]
      return acc
    }, {}) : {},
  }
  return `${cliName}|${body.action}|${JSON.stringify(stable)}`
}

function pruneCache(): void {
  if (cache.size <= MAX_CACHE_ENTRIES) return
  const now = Date.now()
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key)
  }
  if (cache.size > MAX_CACHE_ENTRIES) {
    const overflow = cache.size - MAX_CACHE_ENTRIES
    let i = 0
    for (const key of cache.keys()) {
      if (i >= overflow) break
      cache.delete(key)
      i++
    }
  }
}

@Controller('cli')
export class CliPassthroughController {
  @Post(':cliName')
  async run(@Param('cliName') cliName: string, @Body() body: PassthroughBody) {
    if (!BUILT_IN_CLIS.has(cliName)) {
      return { status: 'error', error: 'CLI_NOT_REGISTERED', message: `Unknown CLI: ${cliName}` }
    }
    if (!body?.action) {
      return { status: 'error', error: 'INVALID_BODY', message: 'action is required' }
    }

    const ttl = body.ttl_ms ?? DEFAULT_TTL_MS
    const key = hashKey(cliName, body)
    const now = Date.now()
    const hit = cache.get(key)
    if (!body.bypass_cache && hit && hit.expiresAt > now) {
      return { ...hit.result, cache: 'hit' }
    }

    const inflight = runWithInflight(key, () => cliBridge.run(cliName, body.action, body.params))
    let result: CLIResult
    try {
      result = await inflight
    } catch (error) {
      return {
        status: 'error',
        error: 'PROCESS_ERROR',
        message: error instanceof Error ? error.message : String(error),
      }
    }

    if (result.status === 'success' && ttl > 0) {
      cache.set(key, { result, expiresAt: now + ttl })
      pruneCache()
    }
    return { ...result, cache: result.status === 'success' ? 'miss' : 'bypass' }
  }
}

const inflightMap = new Map<string, Promise<CLIResult>>()

function runWithInflight(key: string, runner: () => Promise<CLIResult>): Promise<CLIResult> {
  const existing = inflightMap.get(key)
  if (existing) return existing
  const p = runner().finally(() => inflightMap.delete(key))
  inflightMap.set(key, p)
  return p
}
