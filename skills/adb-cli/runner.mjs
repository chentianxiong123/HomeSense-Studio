import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const statePath = path.resolve(__dirname, '..', 'virtual-home-state.json')

export async function run(input = {}) {
  const action = String(input.action ?? '')
  const state = loadState()

  switch (action) {
    case 'wait':
      return respond({
        waited_seconds: Number(input.seconds ?? 0),
        connected: Boolean(state.adb.connected),
        active_package: state.adb.active_package,
      })

    case 'ensure_connected':
      state.adb.connected = true
      state.adb.connection_attempts += 1
      saveState(state)
      return respond({
        connected: true,
        attempts: state.adb.connection_attempts,
        device_id: state.adb.device_id,
      })

    case 'list_packages': {
      const keyword = String(input.keyword ?? '').toLowerCase()
      const packages = keyword
        ? state.adb.packages.filter((pkg) => pkg.toLowerCase().includes(keyword))
        : [...state.adb.packages]
      return respond({
        connected: Boolean(state.adb.connected),
        packages,
        keyword,
      })
    }

    case 'launch_app': {
      const pkg = String(input.package ?? '')
      if (!pkg) {
        return fail('INVALID_PARAMS', 'package is required')
      }
      if (!state.adb.packages.includes(pkg)) {
        return fail('PACKAGE_NOT_FOUND', `package not installed: ${pkg}`)
      }
      state.adb.connected = true
      state.adb.active_package = pkg
      state.adb.last_launch_at = new Date().toISOString()
      saveState(state)
      return respond({
        connected: true,
        launched: pkg,
        active_package: state.adb.active_package,
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
