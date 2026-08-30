import { describe, expect, it } from 'vitest'
import {
  buildDeviceCapabilityRegistry,
  resolveDeviceCapability,
} from './device-capability-registry.js'
import type { CLIBridge } from '../cli-bridge/index.js'

const fakeCliBridge = {
  run: async (cliName: string, action: string) => {
    if (cliName === 'mi-cli' && action === 'device_capabilities') {
      return {
        status: 'success' as const,
        duration_ms: 1,
        data: {
          capabilities: [
            { name: '目标温度', kind: 'property', type: 'integer' },
            { name: '遥控按键', kind: 'action', type: 'string' },
          ],
        },
      }
    }
    return { status: 'error' as const, error: 'UNKNOWN', duration_ms: 1 }
  },
} as unknown as CLIBridge

describe('device capability registry', () => {
  it('builds structured ADB capabilities from device bindings', async () => {
    const capabilities = await buildDeviceCapabilityRegistry({
      id: 1,
      name: '客厅盒子',
      device_type: 'tv_box',
      adb_ip: '192.168.1.20:5555',
    }, fakeCliBridge)

    expect(capabilities).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capability_id: 'adb.launch_app',
        source: 'adb',
        input_schema: expect.objectContaining({
          required: ['package'],
        }),
        metadata: { adb_action: 'launch_app' },
      }),
    ]))
  })

  it('resolves MI Chinese capability names into structured capability ids', async () => {
    const capability = await resolveDeviceCapability({
      id: 2,
      name: '卧室空调',
      device_type: 'air_conditioner',
      mi_did: 'mi-device-1',
    }, {
      capabilityName: '目标温度',
    }, fakeCliBridge)

    expect(capability).toEqual(expect.objectContaining({
      capability_id: 'mi.target_temperature',
      source: 'mi',
      metadata: { mi_capability: 'target_temperature' },
      input_schema: expect.objectContaining({
        required: ['value'],
      }),
    }))
  })
})
