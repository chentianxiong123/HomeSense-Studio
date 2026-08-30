import { pathToFileURL } from 'node:url'
import { loadState, recordEvent, saveState } from '../virtual-home-runtime.mjs'

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
        const sandboxDevice = state.devices?.find((item) => item.legacy_ir_id === device)
        if (sandboxDevice) sandboxDevice.power = true
      }
      state.ir.last_device = device
      state.ir.last_command = normalized
      state.ir.last_command_at = new Date().toISOString()
      recordEvent(state, { source: 'ir', action: 'tv_remote', device, command: normalized })
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
