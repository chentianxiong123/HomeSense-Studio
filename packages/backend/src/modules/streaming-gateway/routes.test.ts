import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { streamingGatewayService } from './index.js'
import { streamingGatewayRoutes } from './routes.js'

describe('streaming gateway routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists and registers streaming hosts', async () => {
    vi.spyOn(streamingGatewayService, 'listHosts').mockReturnValue([
      {
        id: 'integration:12',
        label: 'Gaming PC',
        endpoint: 'https://gaming-pc.local:47990',
        host: 'gaming-pc.local',
        base_port: 47989,
        web_port: 47990,
        tcp_ports: [47984, 47989, 48010],
        udp_ports: [47998, 47999, 48000, 48002, 48010],
        discovery_ports: [5353],
        mac_address: 'AA:BB:CC:DD:EE:FF',
        room: 'Study',
        network_path: 'lan',
        enabled: true,
        status: 'registered',
        integration_id: 12,
        capabilities: ['streaming.host.sunshine'],
      },
    ])
    vi.spyOn(streamingGatewayService, 'registerHost').mockReturnValue({
      id: 'integration:14',
      label: 'Studio PC',
      endpoint: 'https://studio-pc.local:47990',
      host: 'studio-pc.local',
      base_port: 47989,
      web_port: 47990,
      tcp_ports: [47984, 47989, 48010],
      udp_ports: [47998, 47999, 48000, 48002, 48010],
      discovery_ports: [5353],
      mac_address: '11:22:33:44:55:66',
      room: 'Studio',
      network_path: 'vpn',
      enabled: true,
      status: 'registered',
      integration_id: 14,
      capabilities: ['streaming.host.sunshine'],
    })

    const app = Fastify()
    await app.register(streamingGatewayRoutes)

    const list = await app.inject({
      method: 'GET',
      url: '/api/streaming-gateway/hosts',
    })
    expect(list.statusCode).toBe(200)
    expect(JSON.parse(list.body)).toMatchObject({
      status: 'success',
      data: [{ id: 'integration:12' }],
    })

    const create = await app.inject({
      method: 'POST',
      url: '/api/streaming-gateway/hosts',
      payload: { label: 'Studio PC', endpoint: 'studio-pc.local' },
    })
    expect(create.statusCode).toBe(200)
    expect(JSON.parse(create.body)).toMatchObject({
      status: 'success',
      data: { id: 'integration:14', label: 'Studio PC' },
    })

    await app.close()
  })

  it('probes and wakes streaming hosts', async () => {
    vi.spyOn(streamingGatewayService, 'probeHost').mockResolvedValue({
      id: 'integration:12',
      label: 'Gaming PC',
      endpoint: 'https://gaming-pc.local:47990',
      checked_at: '2026-06-01T03:00:00.000Z',
      reachable: false,
      status_code: null,
      ports: [],
      error: 'connection refused',
    })
    vi.spyOn(streamingGatewayService, 'wakeHost').mockResolvedValue({
      id: 'integration:12',
      label: 'Gaming PC',
      mac_address: 'AA:BB:CC:DD:EE:FF',
      broadcast_address: '255.255.255.255',
      port: 9,
      sent: true,
    })

    const app = Fastify()
    await app.register(streamingGatewayRoutes)

    const probe = await app.inject({
      method: 'POST',
      url: '/api/streaming-gateway/hosts/integration:12/probe',
    })
    expect(probe.statusCode).toBe(200)
    expect(JSON.parse(probe.body)).toMatchObject({
      status: 'success',
      data: { reachable: false },
    })

    const wake = await app.inject({
      method: 'POST',
      url: '/api/streaming-gateway/hosts/integration:12/wake',
    })
    expect(wake.statusCode).toBe(200)
    expect(JSON.parse(wake.body)).toMatchObject({
      status: 'success',
      data: { sent: true },
    })

    await app.close()
  })
})
