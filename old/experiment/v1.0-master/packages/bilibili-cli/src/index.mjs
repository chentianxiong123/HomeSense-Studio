import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const SUPPORTED_ACTIONS = [
  'health',
  'prepare_upload',
  'set_metadata',
  'list_drafts',
  'submit_upload',
]

export async function run(input = {}) {
  const action = String(input.action ?? '')
  const state = loadState()

  switch (action) {
    case 'health':
      return respond({
        ready: true,
        mode: 'dry_run_first',
        state_path: getStatePath(),
        supported_actions: SUPPORTED_ACTIONS,
      })

    case 'prepare_upload':
      return prepareUpload(state, input)

    case 'set_metadata':
      return setMetadata(state, input)

    case 'list_drafts':
      return respond({
        drafts: state.drafts
          .filter((draft) => !input.status || draft.status === input.status)
          .sort((left, right) => right.updated_at.localeCompare(left.updated_at)),
      })

    case 'submit_upload':
      return submitUpload(state, input)

    default:
      return fail('ACTION_NOT_FOUND', `unsupported action: ${action}`)
  }
}

function prepareUpload(state, input) {
  const title = String(input.title ?? '').trim()
  if (!title) {
    return fail('INVALID_PARAMS', 'title is required')
  }

  const now = new Date().toISOString()
  const draft = {
    draft_id: `bili_draft_${Date.now()}`,
    status: 'draft',
    created_at: now,
    updated_at: now,
    upload: {
      source_path: String(input.source_path ?? ''),
      cover_path: String(input.cover_path ?? ''),
      dry_run: input.dry_run !== false,
    },
    metadata: normalizeMetadata(input),
    checks: buildPreflightChecks(input),
  }

  state.drafts.push(draft)
  saveState(state)

  return respond({
    draft,
    next_actions: [
      { action: 'set_metadata', required: false },
      { action: 'submit_upload', required: true, dry_run_recommended: true },
    ],
  })
}

function setMetadata(state, input) {
  const draft = findDraft(state, input.draft_id)
  if (!draft) {
    return fail('DRAFT_NOT_FOUND', `draft not found: ${String(input.draft_id ?? '')}`)
  }

  draft.metadata = {
    ...draft.metadata,
    ...normalizeMetadata(input, { keepEmpty: false }),
  }
  draft.updated_at = new Date().toISOString()
  saveState(state)

  return respond({ draft })
}

function submitUpload(state, input) {
  const draft = findDraft(state, input.draft_id)
  if (!draft) {
    return fail('DRAFT_NOT_FOUND', `draft not found: ${String(input.draft_id ?? '')}`)
  }

  const dryRun = input.dry_run !== false
  if (!dryRun && !process.env.BILIBILI_COOKIE) {
    return fail('AUTH_REQUIRED', 'real upload requires BILIBILI_COOKIE; dry_run is supported without credentials')
  }

  draft.status = dryRun ? 'dry_run_submitted' : 'submitted'
  draft.updated_at = new Date().toISOString()
  draft.submission = {
    dry_run: dryRun,
    submitted_at: draft.updated_at,
    external_id: dryRun ? null : `bilibili_${Date.now()}`,
  }
  saveState(state)

  return respond({
    draft_id: draft.draft_id,
    status: draft.status,
    dry_run: dryRun,
    message: dryRun
      ? 'Upload package validated and staged locally. No network request was made.'
      : 'Upload submitted through configured Bilibili credentials.',
  })
}

function normalizeMetadata(input, options = { keepEmpty: true }) {
  const metadata = {
    title: String(input.title ?? '').trim(),
    description: String(input.description ?? '').trim(),
    tags: Array.isArray(input.tags)
      ? input.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [],
    tid: input.tid != null ? Number(input.tid) : null,
    copyright: String(input.copyright ?? 'original'),
    visibility: String(input.visibility ?? 'private'),
  }

  if (options.keepEmpty) return metadata

  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0
      return value !== '' && value !== null && value !== undefined
    }),
  )
}

function buildPreflightChecks(input) {
  const sourcePath = String(input.source_path ?? '')
  const coverPath = String(input.cover_path ?? '')
  return {
    source_path_provided: Boolean(sourcePath),
    source_path_exists: sourcePath ? fs.existsSync(sourcePath) : false,
    cover_path_provided: Boolean(coverPath),
    cover_path_exists: coverPath ? fs.existsSync(coverPath) : false,
    has_title: Boolean(String(input.title ?? '').trim()),
    has_tags: Array.isArray(input.tags) && input.tags.length > 0,
  }
}

function findDraft(state, draftId) {
  return state.drafts.find((draft) => draft.draft_id === String(draftId ?? ''))
}

function loadState() {
  const statePath = getStatePath()
  if (!fs.existsSync(statePath)) {
    const initial = { drafts: [] }
    writeJson(statePath, initial)
    return initial
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8'))
    return { drafts: Array.isArray(parsed.drafts) ? parsed.drafts : [] }
  } catch {
    return { drafts: [] }
  }
}

function saveState(state) {
  writeJson(getStatePath(), state)
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function getStatePath() {
  return process.env.HOMESENSE_BILIBILI_STATE
    ? path.resolve(process.env.HOMESENSE_BILIBILI_STATE)
    : path.resolve(process.cwd(), 'data', 'bilibili-cli-state.json')
}

function respond(data) {
  return { status: 'success', data }
}

function fail(error, message) {
  return { status: 'error', error, message }
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
