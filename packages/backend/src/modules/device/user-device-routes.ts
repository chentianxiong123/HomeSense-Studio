import type { FastifyInstance } from 'fastify'
import { userDeviceFacade, type LegacyCapabilityExecuteBody } from './user-device-facade.js'
export { getAdbCapabilities, getAdbCapabilitiesForCache } from './user-device-facade.js'

export async function userDeviceRoutes(app: FastifyInstance) {
  app.get('/api/user-devices', async () => {
    return userDeviceFacade.listDevices()
  })

  app.get('/api/user-devices/cards', async (request) => {
    const query = request.query as { online?: string }
    const checkOnline = query.online === 'true' || query.online === '1'
    return userDeviceFacade.listCards(checkOnline)
  })

  app.get('/api/user-devices/runtime-manifest', async (request) => {
    const query = request.query as { online?: string; capabilities?: string; limit?: string }
    return userDeviceFacade.getRuntimeManifest({
      online: query.online === 'true' || query.online === '1',
      capabilities: query.capabilities,
      limit: query.limit ? Number(query.limit) : 20,
    })
  })

  app.get('/api/user-devices/ping-all', async () => {
    return userDeviceFacade.pingAll()
  })

  app.get('/api/user-devices/:id', async (request) => {
    const { id } = request.params as { id: string }
    return userDeviceFacade.getDevice(Number(id))
  })

  app.post('/api/user-devices', async (request) => {
    const body = request.body as {
      name: string
      device_type?: string
      room_id?: number | null
      mi_did?: string | null
      adb_ip?: string
      ip_address?: string
    }
    return userDeviceFacade.createDevice(body)
  })

  app.put('/api/user-devices/:id', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      name?: string
      device_type?: string
      room_id?: number | null
      mi_did?: string | null
      adb_ip?: string
      ip_address?: string
    }
    return userDeviceFacade.updateDevice(Number(id), body)
  })

  app.delete('/api/user-devices/:id', async (request) => {
    const { id } = request.params as { id: string }
    return userDeviceFacade.deleteDevice(Number(id))
  })

  app.get('/api/user-devices/:id/capabilities', async (request) => {
    const { id } = request.params as { id: string }
    return userDeviceFacade.getCapabilities(Number(id))
  })

  app.post('/api/user-devices/:id/capabilities/execute', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as LegacyCapabilityExecuteBody
    return userDeviceFacade.executeCapability(Number(id), body)
  })

  app.get('/api/user-devices/:id/ir-keys', async (request) => {
    const { id } = request.params as { id: string }
    const query = request.query as { refresh?: string }
    const forceRefresh = query.refresh === 'true' || query.refresh === '1'
    return userDeviceFacade.getIrKeys(Number(id), forceRefresh)
  })

  app.post('/api/user-devices/:id/ir-press', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { key_id?: string }
    return userDeviceFacade.pressIrKey(Number(id), body.key_id ?? '')
  })

  app.get('/api/user-devices/:id/capabilities/history', async (request) => {
    const { id } = request.params as { id: string }
    return userDeviceFacade.getCapabilityHistory(id)
  })

  app.get('/api/user-devices/:id/apps', async (request) => {
    const { id } = request.params as { id: string }
    const query = request.query as { refresh?: string }
    const forceRefresh = query.refresh === 'true' || query.refresh === '1'
    return userDeviceFacade.getApps(Number(id), forceRefresh)
  })

  app.post('/api/user-devices/:id/apps/launch', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as { package?: string }
    return userDeviceFacade.launchApp(Number(id), body.package)
  })

  app.get('/api/user-devices/mi-candidates', async () => {
    return userDeviceFacade.listMiCandidates()
  })
}
