import { pathToFileURL } from 'node:url'
import { attachProjection, buildStateProjection, loadState, recordEvent, saveState } from '../virtual-home-runtime.mjs'

export async function run(input = {}) {
  const action = String(input.action ?? '')
  const state = loadState()
  const before = buildStateProjection(state)
  let result

  switch (action) {
    case 'scene_execute':
      result = executeScene(state, input)
      break

    case 'speaker_execute':
      result = executeSpeakerCommand(state, input)
      break

    case 'speaker_play':
      result = executeSpeakerPlay(state, input)
      break

    case 'device_action':
      result = executeDeviceAction(state, input)
      break

    case 'device_ir_press':
      result = executeIrPress(state, input)
      break

    default:
      result = fail('ACTION_NOT_FOUND', `unsupported action: ${action}`)
  }

  return attachProjection(result, before, buildStateProjection(loadState()), action)
}

function executeScene(state, input) {
  const sceneName = String(input.scene_name ?? input.scene_id ?? '').trim()
  if (!sceneName) return fail('INVALID_PARAMS', 'scene_name or scene_id is required')

  if (sceneName.includes('电视') || sceneName.toLowerCase().includes('tv')) {
    setDevicePowerByType(state, 'television', true)
    setDevicePowerByType(state, 'stb', true)
    state.ir.tvs_toshiba = true
    state.ir.stb = true
  }

  recordEvent(state, {
    source: 'mi',
    action: 'scene_execute',
    scene_name: sceneName,
    sandbox: true,
  })
  saveState(state)
  return respond({ executed: true, scene_name: sceneName, sandbox: true })
}

function executeSpeakerCommand(state, input) {
  const text = String(input.text ?? '').trim()
  if (!text) return fail('INVALID_PARAMS', 'text is required')

  if (/(打开|开机|启动).*(电视|机顶盒|盒子)/.test(text)) {
    setDevicePowerByType(state, 'television', true)
    setDevicePowerByType(state, 'stb', true)
    state.ir.tvs_toshiba = true
    state.ir.stb = true
  }
  if (/(关闭|关机).*(电视|机顶盒|盒子)/.test(text)) {
    setDevicePowerByType(state, 'television', false)
    setDevicePowerByType(state, 'stb', false)
    state.ir.tvs_toshiba = false
    state.ir.stb = false
  }

  recordEvent(state, {
    source: 'mi',
    action: 'speaker_execute',
    text,
    did: input.did ?? null,
    silent: Boolean(input.silent),
    sandbox: true,
  })
  saveState(state)
  return respond({ accepted: true, text, sandbox: true })
}

function executeSpeakerPlay(state, input) {
  const text = String(input.text ?? '').trim()
  if (!text) return fail('INVALID_PARAMS', 'text is required')
  recordEvent(state, {
    source: 'mi',
    action: 'speaker_play',
    text,
    did: input.did ?? null,
    sandbox: true,
  })
  saveState(state)
  return respond({ played: true, text, sandbox: true })
}

function executeDeviceAction(state, input) {
  const did = String(input.did ?? '').trim()
  const capability = String(input.capability ?? '').trim()
  if (!did || !capability) return fail('INVALID_PARAMS', 'did and capability are required')

  if (['turn_on', 'power_on', '开机'].includes(capability)) {
    setDevicePowerByDidOrType(state, did, true)
  }
  if (['shutdown', 'turn_off', 'power_off', '关机'].includes(capability)) {
    setDevicePowerByDidOrType(state, did, false)
  }

  recordEvent(state, {
    source: 'mi',
    action: 'device_action',
    did,
    capability,
    params: Array.isArray(input.params) ? input.params : [],
    sandbox: true,
  })
  saveState(state)
  return respond({ did, capability, sandbox: true })
}

function executeIrPress(state, input) {
  const did = String(input.did ?? '').trim()
  const keyId = String(input.key_id ?? '').trim()
  if (!did || !keyId) return fail('INVALID_PARAMS', 'did and key_id are required')

  recordEvent(state, {
    source: 'mi',
    action: 'device_ir_press',
    did,
    key_id: keyId,
    sandbox: true,
  })
  saveState(state)
  return respond({ did, key_id: keyId, sandbox: true })
}

function setDevicePowerByType(state, deviceType, value) {
  for (const device of state.devices ?? []) {
    if (device.device_type === deviceType) device.power = value
  }
}

function setDevicePowerByDidOrType(state, did, value) {
  for (const device of state.devices ?? []) {
    if (device.real_mi_did === did || device.mi_did === did || device.device_type === did) {
      device.power = value
    }
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
