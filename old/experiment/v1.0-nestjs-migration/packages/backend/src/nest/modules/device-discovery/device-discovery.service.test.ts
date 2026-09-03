import { describe, expect, it, vi } from 'vitest'
import { DeviceDiscoveryService } from './device-discovery.service.js'
import type { AdbService } from './services/adb.service.js'
import type { MiHomeService } from './services/mi-home.service.js'
import type { CliCompatService } from './external/cli-compat.service.js'

function makeAdb(overrides: Partial<AdbService> = {}): AdbService {
  return {
    listDevices: vi.fn().mockResolvedValue([]),
    connectTcp: vi.fn().mockResolvedValue('serial-1'),
    disconnect: vi.fn().mockResolvedValue(undefined),
    shell: vi.fn().mockResolvedValue('ok'),
    listPackages: vi.fn().mockResolvedValue(['com.example']),
    takeScreenshot: vi.fn().mockResolvedValue({ format: 'png' as const, base64: 'abc' }),
    tap: vi.fn().mockResolvedValue(undefined),
    inputText: vi.fn().mockResolvedValue(undefined),
    keyEvent: vi.fn().mockResolvedValue(undefined),
    launchApp: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as AdbService
}

function makeMiHome(overrides: Partial<MiHomeService> = {}): MiHomeService {
  return {
    startDiscovery: vi.fn(),
    stopDiscovery: vi.fn(),
    listDiscovered: vi.fn().mockReturnValue([]),
    call: vi.fn(),
    onModuleDestroy: vi.fn(),
    ...overrides,
  } as unknown as MiHomeService
}

function makeCli(overrides: Partial<CliCompatService> = {}): CliCompatService {
  return {
    run: vi.fn().mockResolvedValue({ status: 'success' as const, data: { devices: [], homes: [] } }),
    runWithRetry: vi.fn().mockResolvedValue({ status: 'success' as const, data: { devices: [], homes: [] } }),
    ...overrides,
  } as unknown as CliCompatService
}

describe('DeviceDiscoveryService', () => {
  it('uses native adb listDevices by default', async () => {
    const adb = makeAdb({ listDevices: vi.fn().mockResolvedValue([{ serial: 'x', state: 'device' }]) })
    const miHome = makeMiHome()
    const cli = makeCli()
    const svc = new DeviceDiscoveryService(adb, miHome, cli)

    const result = await svc.discover()
    expect(adb.listDevices).toHaveBeenCalled()
    expect(miHome.startDiscovery).toHaveBeenCalledWith(8000)
    expect(result.adb).toEqual([{ serial: 'x', state: 'device' }])
    expect(result.source).toBe('native')
  })

  it('falls back to CLI when useCli is true', async () => {
    const adb = makeAdb()
    const miHome = makeMiHome()
    const cli = makeCli({
      run: vi.fn().mockResolvedValue({
        status: 'success' as const,
        data: {
          devices: [{ serial: 'cli-1', state: 'device' }],
          homes: [{ id: 'mi-1', address: '192.168.0.10', model: 'yeelink.light', token: 'tok' }],
        },
      }),
    })
    const svc = new DeviceDiscoveryService(adb, miHome, cli)

    const result = await svc.discover({ useCli: true })
    expect(adb.listDevices).not.toHaveBeenCalled()
    expect(cli.run).toHaveBeenCalledWith('mi-cli', 'discover', { renew: false })
    expect(result.adb).toEqual([{ serial: 'cli-1', state: 'device' }])
    expect(result.mi).toHaveLength(1)
    expect(result.source).toBe('cli')
  })

  it('pingAdb returns alive=true on echo ok', async () => {
    const adb = makeAdb({ shell: vi.fn().mockResolvedValue('ok\n') })
    const svc = new DeviceDiscoveryService(adb, makeMiHome(), makeCli())
    const result = await svc.pingAdb('serial-1')
    expect(result.alive).toBe(true)
  })

  it('pingAdb returns alive=false on shell error', async () => {
    const adb = makeAdb({ shell: vi.fn().mockRejectedValue(new Error('device offline')) })
    const svc = new DeviceDiscoveryService(adb, makeMiHome(), makeCli())
    const result = await svc.pingAdb('serial-1')
    expect(result.alive).toBe(false)
  })
})
