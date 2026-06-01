import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const STRUCTURED_ACTIONS = new Set([
  'status',
  'whoami',
  'video',
  'user',
  'user_videos',
  'search',
  'hot',
  'rank',
  'favorites',
  'following',
  'watch_later',
  'history',
  'feed',
  'my_dynamics',
  'dynamic_post',
  'dynamic_delete',
  'like',
  'coin',
  'triple',
  'unfollow',
])

const SUPPORTED_ACTIONS = ['health', ...Array.from(STRUCTURED_ACTIONS)]
const DEFAULT_TIMEOUT_MS = 60_000

export async function run(input = {}) {
  const action = String(input.action ?? '').trim()
  if (!action) return fail('INVALID_PARAMS', 'action is required')

  if (action === 'health') {
    return health()
  }

  if (!STRUCTURED_ACTIONS.has(action)) {
    return fail('ACTION_NOT_FOUND', `unsupported action: ${action}`)
  }

  const built = buildBiliCommand(action, input)
  if (built.status === 'error') return built

  try {
    const stdout = await execFile('uv', ['run', 'bili', ...built.args, '--json'], {
      cwd: getReferenceDir(),
      timeoutMs: Number(input.timeout_ms ?? DEFAULT_TIMEOUT_MS),
    })
    return normalizeBiliEnvelope(stdout, {
      action,
      command: ['uv', 'run', 'bili', ...built.args, '--json'],
    })
  } catch (error) {
    return fail('PROCESS_ERROR', error instanceof Error ? error.message : String(error), {
      action,
      command: ['uv', 'run', 'bili', ...built.args, '--json'],
      reference_dir: getReferenceDir(),
    })
  }
}

function health() {
  const referenceDir = getReferenceDir()
  const pyproject = path.join(referenceDir, 'pyproject.toml')
  const skill = path.join(referenceDir, 'SKILL.md')
  const uv = spawnSync('uv', ['--version'], { encoding: 'utf8' })
  const uvAvailable = uv.status === 0
  return respond({
    ready: fs.existsSync(pyproject) && uvAvailable,
    adapter: 'jackwener/bilibili-cli',
    mode: 'real_cli_bridge',
    reference_dir: referenceDir,
    pyproject_exists: fs.existsSync(pyproject),
    skill_exists: fs.existsSync(skill),
    uv_available: uvAvailable,
    uv_version: uvAvailable ? uv.stdout.trim() : '',
    entrypoint: 'uv run bili',
    supported_actions: SUPPORTED_ACTIONS,
    output: 'maps bilibili-cli ok/schema_version/data/error envelope to HomeSense status/data/error envelope',
  })
}

function getReferenceDir() {
  if (process.env.HOMESENSE_BILIBILI_CLI_DIR) {
    return path.resolve(process.env.HOMESENSE_BILIBILI_CLI_DIR)
  }

  const moduleDir = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(moduleDir, '../../../../HomeSense/References/bilibili-cli')
}

function buildBiliCommand(action, input) {
  switch (action) {
    case 'status':
    case 'whoami':
      return ok([action])
    case 'video':
      return withRequiredArg(input, ['bv_or_url', 'url', 'bvid', 'id'], (target) => [
        'video',
        target,
        ...boolFlag(input.subtitle, '--subtitle'),
        ...boolFlag(input.subtitle_timeline, '--subtitle-timeline'),
        ...stringFlag(input.subtitle_format, '--subtitle-format'),
        ...boolFlag(input.comments, '--comments'),
        ...boolFlag(input.ai, '--ai'),
        ...boolFlag(input.related, '--related'),
      ])
    case 'user':
      return withRequiredArg(input, ['uid_or_name', 'uid', 'name', 'id'], (target) => ['user', target])
    case 'user_videos':
      return withRequiredArg(input, ['uid_or_name', 'uid', 'name', 'id'], (target) => [
        'user-videos',
        target,
        ...numberFlag(input.max, '--max'),
      ])
    case 'search':
      return withRequiredArg(input, ['query', 'keyword', 'q'], (query) => [
        'search',
        query,
        ...stringFlag(input.type ?? input.search_type, '--type'),
        ...numberFlag(input.page, '--page'),
        ...numberFlag(input.max, '--max'),
      ])
    case 'hot':
      return ok(['hot', ...numberFlag(input.page, '--page'), ...numberFlag(input.max, '--max')])
    case 'rank':
      return ok(['rank', ...stringFlag(input.day, '--day'), ...numberFlag(input.max, '--max')])
    case 'favorites':
      return ok([
        'favorites',
        ...optionalPositional(input.fav_id ?? input.favorite_id ?? input.id),
        ...numberFlag(input.page, '--page'),
      ])
    case 'following':
      return ok(['following', ...numberFlag(input.page, '--page')])
    case 'watch_later':
      return ok(['watch-later'])
    case 'history':
      return ok(['history', ...numberFlag(input.page, '--page'), ...numberFlag(input.max, '--max')])
    case 'feed':
      return ok(['feed', ...stringFlag(input.offset, '--offset')])
    case 'my_dynamics':
      return ok([
        'my-dynamics',
        ...stringFlag(input.offset, '--offset'),
        ...numberFlag(input.max, '--max'),
        ...boolFlag(input.top, '--top'),
      ])
    case 'dynamic_post':
      return withRequiredArg(input, ['text'], (text) => ['dynamic-post', text])
    case 'dynamic_delete':
      return withRequiredArg(input, ['dynamic_id', 'id'], (dynamicId) => [
        'dynamic-delete',
        dynamicId,
        ...boolFlag(input.yes, '--yes'),
      ])
    case 'like':
      return withRequiredArg(input, ['bv_or_url', 'url', 'bvid', 'id'], (target) => [
        'like',
        target,
        ...boolFlag(input.undo, '--undo'),
      ])
    case 'coin':
      return withRequiredArg(input, ['bv_or_url', 'url', 'bvid', 'id'], (target) => [
        'coin',
        target,
        ...numberFlag(input.num ?? input.coins, '--num'),
      ])
    case 'triple':
      return withRequiredArg(input, ['bv_or_url', 'url', 'bvid', 'id'], (target) => ['triple', target])
    case 'unfollow':
      return withRequiredArg(input, ['uid', 'id'], (uid) => ['unfollow', uid, ...boolFlag(input.yes, '--yes')])
    default:
      return fail('ACTION_NOT_FOUND', `unsupported action: ${action}`)
  }
}

function withRequiredArg(input, keys, build) {
  for (const key of keys) {
    const value = input[key]
    if (value !== undefined && value !== null && String(value).trim()) {
      return ok(build(String(value).trim()))
    }
  }
  return fail('INVALID_PARAMS', `${keys[0]} is required`)
}

function ok(args) {
  return { status: 'success', args }
}

function optionalPositional(value) {
  if (value === undefined || value === null || value === '') return []
  return [String(value)]
}

function stringFlag(value, name) {
  if (value === undefined || value === null || value === '') return []
  return [name, String(value)]
}

function numberFlag(value, name) {
  if (value === undefined || value === null || value === '') return []
  const number = Number(value)
  if (!Number.isFinite(number)) return []
  return [name, String(number)]
}

function boolFlag(value, name) {
  return value === true ? [name] : []
}

function execFile(executable, args, options) {
  return new Promise((resolve, reject) => {
    const proc = spawn(executable, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      proc.kill()
      reject(new Error(`Process timeout after ${options.timeoutMs}ms`))
    }, options.timeoutMs)

    proc.stdout?.on('data', (chunk) => { stdout += chunk.toString() })
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    proc.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    proc.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        resolve(stdout.trim())
        return
      }
      reject(new Error(`bilibili-cli exited with code ${code}: ${stderr.trim() || stdout.trim()}`))
    })
  })
}

function normalizeBiliEnvelope(stdout, meta) {
  const parsed = parseJson(stdout)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail('PARSE_ERROR', 'bilibili-cli did not return a JSON object', { ...meta, stdout })
  }

  if (parsed.ok === true) {
    return respond({
      schema_version: parsed.schema_version,
      data: parsed.data,
      warnings: parsed.warnings,
      meta,
    })
  }

  if (parsed.ok === false) {
    return fail(
      String(parsed.error?.code ?? 'BILIBILI_CLI_ERROR'),
      String(parsed.error?.message ?? 'bilibili-cli returned an error'),
      { ...meta, envelope: parsed },
    )
  }

  return respond({ data: parsed, meta })
}

function parseJson(raw) {
  try {
    return JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(raw.slice(start, end + 1))
      } catch {}
    }
    return null
  }
}

function respond(data) {
  return { status: 'success', data }
}

function fail(error, message, data) {
  return { status: 'error', error, message, ...(data ? { data } : {}) }
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
