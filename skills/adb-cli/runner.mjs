import { pathToFileURL } from 'node:url'
import { attachProjection, buildStateProjection, loadState, recordEvent, saveState } from '../virtual-home-runtime.mjs'

export async function run(input = {}) {
  const action = String(input.action ?? '')
  const state = loadState()
  const before = buildStateProjection(state)
  let result

  switch (action) {
    case 'wait':
      result = respond({
        waited_seconds: Number(input.seconds ?? 0),
        connected: Boolean(state.adb.connected),
        active_package: state.adb.active_package,
      })
      break

    case 'ensure_connected':
      state.adb.connected = true
      state.adb.connection_attempts += 1
      recordEvent(state, { source: 'adb', action: 'ensure_connected', device_id: state.adb.device_id, sandbox: true })
      saveState(state)
      result = respond({
        connected: true,
        attempts: state.adb.connection_attempts,
        device_id: state.adb.device_id,
      })
      break

    case 'list_packages': {
      const keyword = String(input.keyword ?? '').toLowerCase()
      const packages = keyword
        ? state.adb.packages.filter((pkg) => pkg.toLowerCase().includes(keyword))
        : [...state.adb.packages]
      result = respond({
        connected: Boolean(state.adb.connected),
        packages,
        keyword,
      })
      break
    }

    case 'launch_app': {
      const pkg = String(input.package ?? '')
      if (!pkg) {
        result = fail('INVALID_PARAMS', 'package is required')
        break
      }
      if (!state.adb.packages.includes(pkg)) {
        result = fail('PACKAGE_NOT_FOUND', `package not installed: ${pkg}`)
        break
      }
      state.adb.connected = true
      state.adb.active_package = pkg
      state.adb.last_launch_at = new Date().toISOString()
      recordEvent(state, { source: 'adb', action: 'launch_app', package: pkg, sandbox: true })
      saveState(state)
      result = respond({
        connected: true,
        launched: pkg,
        active_package: state.adb.active_package,
      })
      break
    }

    case 'back':
    case 'home':
    case 'enter':
    case 'volume_up':
    case 'volume_down':
    case 'wake': {
      state.adb.connected = true
      recordEvent(state, { source: 'adb', action, sandbox: true })
      saveState(state)
      result = respond({
        connected: true,
        action,
        active_package: state.adb.active_package,
      })
      break
    }

    case 'power': {
      state.adb.connected = true
      const stb = state.devices?.find((item) => item.device_type === 'stb')
      if (stb) stb.power = !Boolean(stb.power)
      if (state.ir && typeof state.ir.stb === 'boolean') state.ir.stb = !state.ir.stb
      recordEvent(state, { source: 'adb', action: 'power', powered_on: Boolean(stb?.power), sandbox: true })
      saveState(state)
      result = respond({
        connected: true,
        action: 'power',
        powered_on: Boolean(stb?.power),
      })
      break
    }

    case 'tap': {
      const x = Number(input.x)
      const y = Number(input.y)
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        result = fail('INVALID_PARAMS', 'x and y are required')
        break
      }
      recordEvent(state, { source: 'adb', action: 'tap', x, y, sandbox: true })
      saveState(state)
      result = respond({ x, y })
      break
    }

    case 'input_text': {
      const text = String(input.text ?? '')
      if (!text) {
        result = fail('INVALID_PARAMS', 'text is required')
        break
      }
      recordEvent(state, { source: 'adb', action: 'input_text', text, sandbox: true })
      saveState(state)
      result = respond({ text })
      break
    }

    case 'screenshot':
      recordEvent(state, { source: 'adb', action: 'screenshot', sandbox: true })
      saveState(state)
      result = respond({
        path: 'sandbox://screenshot/latest.png',
        width: 1920,
        height: 1080,
        size_bytes: 0,
        synthetic: true,
      })
      break

    case 'current_app':
      result = respond({
        current_app: state.adb.active_package,
        activity: state.adb.active_package ? `${state.adb.active_package}/.MainActivity` : null,
        synthetic: true,
      })
      break

    case 'ui_tree':
      result = respond({
        elements: buildSyntheticElements(state.adb.active_package),
        count: buildSyntheticElements(state.adb.active_package).length,
        formatted: buildSyntheticElements(state.adb.active_package)
          .map((item) => `${item.index}. ${item.text} ${item.bounds}`)
          .join('\n'),
        synthetic: true,
      })
      break

    case 'tap_element': {
      const elements = buildSyntheticElements(state.adb.active_package)
      const index = input.index == null ? null : Number(input.index)
      const text = String(input.text ?? '')
      const element = Number.isFinite(index)
        ? elements.find((item) => item.index === index)
        : elements.find((item) => item.text.includes(text))
      if (!element) {
        result = fail('ELEMENT_NOT_FOUND', 'element not found in sandbox UI tree')
        break
      }
      recordEvent(state, { source: 'adb', action: 'tap_element', element, sandbox: true })
      saveState(state)
      result = respond({ element })
      break
    }

    case 'swipe': {
      const startX = Number(input.start_x)
      const startY = Number(input.start_y)
      const endX = Number(input.end_x)
      const endY = Number(input.end_y)
      const duration = input.duration == null ? 300 : Number(input.duration)
      if (![startX, startY, endX, endY].every(Number.isFinite)) {
        result = fail('INVALID_PARAMS', 'start_x,start_y,end_x,end_y are required')
        break
      }
      recordEvent(state, {
        source: 'adb',
        action: 'swipe',
        start: { x: startX, y: startY },
        end: { x: endX, y: endY },
        duration,
        sandbox: true,
      })
      saveState(state)
      result = respond({ start: { x: startX, y: startY }, end: { x: endX, y: endY }, duration })
      break
    }

    default:
      result = fail('ACTION_NOT_FOUND', `unsupported action: ${action}`)
  }

  return attachProjection(result, before, buildStateProjection(loadState()), action)
}

function buildSyntheticElements(activePackage) {
  if (activePackage === 'com.xiaodianshi.tv.yst' || activePackage === 'tv.danmaku.bili') {
    return [
      { index: 1, text: '搜索', bounds: '[80,60][220,140]', clickable: true, center: { x: 150, y: 100 } },
      { index: 2, text: '推荐', bounds: '[260,60][420,140]', clickable: true, center: { x: 340, y: 100 } },
      { index: 3, text: '历史记录', bounds: '[460,60][660,140]', clickable: true, center: { x: 560, y: 100 } },
    ]
  }
  return [
    { index: 1, text: '主页', bounds: '[80,60][220,140]', clickable: true, center: { x: 150, y: 100 } },
    { index: 2, text: '设置', bounds: '[260,60][420,140]', clickable: true, center: { x: 340, y: 100 } },
  ]
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
