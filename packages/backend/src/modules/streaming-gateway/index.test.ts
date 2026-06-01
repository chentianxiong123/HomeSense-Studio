import { describe, expect, it, vi } from 'vitest'
import type { ExternalIntegrationRecord } from '../external-integrations/index.js'
import { StreamingGatewayService } from './index.js'

function makeIntegration(overrides: Partial<ExternalIntegrationRecord> = {}): ExternalIntegrationRecord {
  return {
    id: 12,
    name: 'streaming-host-gaming-pc',
    kind: 'http',
    endpoint: 'https://gaming-pc.local:47990',
    description: 'Sunshine streaming host: Gaming PC',
    capability_ids: ['streaming.host.sunshine', 'streaming.wake_on_lan'],
    actions: [],
    enabled: true,
    metadata: {
      role: 'streaming_sunshine_host',
      streaming_host: {
        label: 'Gaming PC',
        host: 'gaming-pc.local',
        base_port: 47989,
        web_port: 47990,
        mac_address: 'AA:BB:CC:DD:EE:FF',
        room: 'Study',
        network_path: 'lan',
      },
    },
    created_at: '2026-06-01 00:00:00',
    updated_at: '2026-06-01 00:00:00',
    ...overrides,
  }
}

describe('StreamingGatewayService', () => {
  it('lists Sunshine hosts from external integrations', () => {
    const service = new StreamingGatewayService({
      listIntegrations: () => [
        makeIntegration(),
        makeIntegration({
          id: 13,
          name: 'unrelated',
          metadata: { role: 'other' },
        }),
      ],
    })

    const hosts = service.listHosts()

    expect(hosts).toHaveLength(1)
    expect(hosts[0]).toMatchObject({
      id: 'integration:12',
      label: 'Gaming PC',
      endpoint: 'https://gaming-pc.local:47990',
      base_port: 47989,
      web_port: 47990,
      tcp_ports: [47984, 47989, 48010],
      udp_ports: [47998, 47999, 48000, 48002, 48010],
      mac_address: 'AA:BB:CC:DD:EE:FF',
      network_path: 'lan',
    })
  })

  it('registers a Sunshine host through external integrations', () => {
    const registerIntegration = vi.fn((input: any) => makeIntegration({
      id: 14,
      name: input.name,
      endpoint: input.endpoint,
      capability_ids: input.capability_ids,
      actions: input.actions,
      metadata: input.metadata,
    }))
    const service = new StreamingGatewayService({ registerIntegration })

    const host = service.registerHost({
      label: 'Studio PC',
      endpoint: 'studio-pc.local',
      mac_address: '11:22:33:44:55:66',
      room: 'Studio',
      network_path: 'vpn',
    })

    expect(host).toMatchObject({
      id: 'integration:14',
      label: 'Studio PC',
      endpoint: 'https://studio-pc.local:47990',
      base_port: 47989,
      web_port: 47990,
      mac_address: '11:22:33:44:55:66',
      network_path: 'vpn',
    })
    expect(registerIntegration).toHaveBeenCalledWith(expect.objectContaining({
      name: expect.stringContaining('streaming-host-studio-pc'),
      capability_ids: expect.arrayContaining(['streaming.host.sunshine', 'streaming.wake_on_lan']),
      metadata: expect.objectContaining({ role: 'streaming_sunshine_host' }),
    }))
  })

  it('probes a Sunshine host without inventing readiness', async () => {
    const fetchImpl = vi.fn(async () => new Response('ok', { status: 200 }))
    const service = new StreamingGatewayService({
      listIntegrations: () => [makeIntegration()],
      fetchImpl,
      now: () => new Date('2026-06-01T03:00:00.000Z'),
    })

    const probe = await service.probeHost('integration:12')

    expect(probe).toMatchObject({
      id: 'integration:12',
      reachable: true,
      status_code: 200,
      checked_at: '2026-06-01T03:00:00.000Z',
    })
    expect(probe?.ports).toEqual(expect.arrayContaining([
      expect.objectContaining({ protocol: 'tcp', port: 47984 }),
      expect.objectContaining({ protocol: 'tcp', port: 47989 }),
      expect.objectContaining({ protocol: 'tcp', port: 48010 }),
      expect.objectContaining({ protocol: 'udp', port: 47998, checked: false }),
      expect.objectContaining({ protocol: 'udp', port: 5353, role: 'discovery' }),
    ]))
  })

  it('sends Wake-on-LAN only when a MAC address is configured', async () => {
    const sendWakePacket = vi.fn(async () => {})
    const service = new StreamingGatewayService({
      listIntegrations: () => [makeIntegration()],
      sendWakePacket,
    })

    const result = await service.wakeHost('integration:12')

    expect(result).toMatchObject({
      id: 'integration:12',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      sent: true,
    })
    expect(sendWakePacket).toHaveBeenCalledWith('AA:BB:CC:DD:EE:FF', '255.255.255.255', 9)
  })
})
