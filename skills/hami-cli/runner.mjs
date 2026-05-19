import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const statePath = path.resolve(__dirname, '..', 'virtual-home-state.json')

export async function run(input = {}) {
  const action = String(input.action ?? '')
  const state = loadState()

  switch (action) {
    case 'tv_remote': {
      const device = String(input.device ?? '')
      const command = String(input.command ?? '')
      if (!device || !command) {
        return fail('INVALID_PARAMS', 'device and command are required')
      }
      const normalized = command.trim()
      if (!(device in state.ir)) {
        return fail('DEVICE_NOT_FOUND', `unknown device: ${device}`)
      }
      if (normalized === '电源' || normalized.toLowerCase() === 'power') {
        state.ir[device] = true
      }
      state.ir.last_device = device
      state.ir.last_command = normalized
      state.ir.last_command_at = new Date().toISOString()
      saveState(state)
      return respond({
        device,
        command: normalized,
        powered_on: Boolean(state.ir[device]),
      })
    }

    default:
      return fail('ACTION_NOT_FOUND', `unsupported action: ${action}`)
  }
}

function loadState() {
  if (!fs.existsSync(statePath)) {
    const initial = createInitialState()
    fs.writeFileSync(statePath, JSON.stringify(initial, null, 2))
    return initial
  }

  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf-8'))
  } catch {
    const initial = createInitialState()
    fs.writeFileSync(statePath, JSON.stringify(initial, null, 2))
    return initial
  }
}

function saveState(state) {
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2))
}

function createInitialState() {
  return {
    adb: {
      device_id: 'virtual-android-tv',
      connected: false,
      connection_attempts: 0,
      active_package: null,
      last_launch_at: null,
      packages: [
        'com.xiaodianshi.tv.yst',
        'tv.danmaku.bili',
        'com.dangbei.tvlauncher',
      ],
    },
    ir: {
      tvs_toshiba: false,
      stb: false,
      last_device: null,
      last_command: null,
      last_command_at: null,
    },
  }
}

function respond(data) {
  return { status: 'success', data }
}

function fail(error, message) {
  return { status: 'error', error, message }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const input = process.argv[2] ? JSON.parse(process.argv[2]) : {}
  const result = await run(input)
  process.stdout.write(JSON.stringify(result))
}
