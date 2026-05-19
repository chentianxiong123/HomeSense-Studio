import type { FastifyInstance } from 'fastify'
import { cliBridge } from '../cli-bridge/index.js'
import { getDb } from '../../db/index.js'

export async function deviceRoutes(app: FastifyInstance) {
  app.get('/api/devices', async () => {
    const result = await cliBridge.run('mi-cli', 'discover')
    if (result.status === 'success' && result.data) {
      const data = result.data as { devices?: unknown[] }
      return { devices: data.devices ?? [], duration_ms: result.duration_ms }
    }
    return { devices: [], error: (result as any).error, message: (result as any).message }
  })

  app.post('/api/devices/discover', async (request) => {
    const body = request.body as { renew?: boolean } | null
    const result = await cliBridge.runWithRetry('mi-cli', 'discover', { renew: body?.renew ?? false })
    if (result.status === 'success' && result.data) {
      const data = result.data as { devices?: Array<Record<string, unknown>>; homes?: Array<Record<string, unknown>> }
      return { devices: data.devices ?? [], homes: data.homes ?? [], duration_ms: result.duration_ms }
    }
    return { devices: [], error: (result as any).error, message: (result as any).message, duration_ms: result.duration_ms }
  })

  app.get('/api/devices/mi/diagnostics', async () => {
    const started = Date.now()
    const steps: Array<{
      key: string
      label: string
      status: 'success' | 'error' | 'skipped'
      duration_ms: number
      data?: unknown
      error?: string
      message?: string
    }> = []

    async function runStep(
      key: string,
      label: string,
      action: string,
      params?: Record<string, unknown>,
    ) {
      const stepStart = Date.now()
      const result = await cliBridge.run('mi-cli', action, params)
      const step = {
        key,
        label,
        status: result.status === 'success' ? 'success' as const : 'error' as const,
        duration_ms: Date.now() - stepStart,
        data: result.status === 'success' ? result.data : undefined,
        error: result.status === 'error' ? result.error : undefined,
        message: result.status === 'error' ? result.message : undefined,
      }
      steps.push(step)
      return result
    }

    const auth = await runStep('auth', 'Mi Home auth status', 'login_status')
    const authData = auth.status === 'success' && auth.data && typeof auth.data === 'object'
      ? auth.data as { logged_in?: boolean }
      : {}

    if (authData.logged_in) {
      await runStep('discover', 'Mi Home device discovery', 'discover')
      await runStep('scenes', 'Mijia scene list', 'scene_list', {})
      await runStep('speakers', 'XiaoAi speaker list', 'speaker_list')
    } else {
      for (const skipped of [
        ['discover', 'Mi Home device discovery'],
        ['scenes', 'Mijia scene list'],
        ['speakers', 'XiaoAi speaker list'],
      ] as const) {
        steps.push({
          key: skipped[0],
          label: skipped[1],
          status: 'skipped',
          duration_ms: 0,
          message: 'Login required before running this step.',
        })
      }
    }

    return {
      status: 'success',
      duration_ms: Date.now() - started,
      logged_in: Boolean(authData.logged_in),
      steps,
    }
  })

  app.get('/api/devices/scenes', async (request) => {
    const query = request.query as { home_id?: string }
    const result = await cliBridge.run('mi-cli', 'scene_list', query.home_id ? { home_id: query.home_id } : {})
    if (result.status === 'success') return result.data
    return { scenes: [], error: (result as any).error, message: (result as any).message, duration_ms: result.duration_ms }
  })

  app.post('/api/devices/scenes/execute', async (request) => {
    const body = request.body as { scene_id?: string; scene_name?: string; home_id?: string }
    return cliBridge.run('mi-cli', 'scene_execute', body)
  })

  app.get('/api/devices/speakers', async () => {
    const result = await cliBridge.run('mi-cli', 'speaker_list')
    if (result.status === 'success') return result.data
    return { speakers: [], error: (result as any).error, message: (result as any).message, duration_ms: result.duration_ms }
  })

  app.get('/api/devices/ir/controllers/:parentDid', async (request) => {
    const { parentDid } = request.params as { parentDid: string }
    const result = await cliBridge.run('mi-cli', 'ir_discover', { parent_did: parentDid })
    if (result.status === 'success') return result.data
    return { controllers: [], error: (result as any).error, message: (result as any).message, duration_ms: result.duration_ms }
  })

  app.get('/api/devices/ir/keys/:controllerId', async (request) => {
    const { controllerId } = request.params as { controllerId: string }
    const result = await cliBridge.run('mi-cli', 'ir_get_keys', { controller_id: controllerId })
    if (result.status === 'success') return result.data
    return { keys: [], error: (result as any).error, message: (result as any).message, duration_ms: result.duration_ms }
  })

  app.get('/api/devices/:did', async (request) => {
    const { did } = request.params as { did: string }
    const db = getDb()
    const device = db.prepare('SELECT * FROM devices WHERE did = ?').get(did)
    if (!device) {
      return { status: 'error', error: 'DEVICE_NOT_FOUND' }
    }
    const features = db.prepare('SELECT * FROM device_features WHERE device_did = ?').all(did)
    const entities = db.prepare('SELECT * FROM entities WHERE device_did = ?').all(did)
    return { device, features, entities }
  })

  // ── 对照 hass-xiaomi-miot async_get_properties_for_mapping ──
  // POST /api/devices/:did/props
  // Body: { mapping?: Record<string, {siid,piid}> }, props?: [{siid,piid}] }
  // 返回云端实时 MIoT 属性值
  app.post('/api/devices/:did/props', async (request) => {
    const { did } = request.params as { did: string }
    const body = request.body as {
      mapping?: Record<string, { siid: number; piid: number }>
      props?: Array<{ siid: number; piid: number }>
    }

    if (body.mapping) {
      const pms: Array<{ did: string; siid: number; piid: number }> = []
      const rmp: Record<string, string> = {}
      for (const [key, v] of Object.entries(body.mapping)) {
        pms.push({ did, siid: v.siid, piid: v.piid })
        rmp[`prop.${v.siid}.${v.piid}`] = key
      }
      const result = await cliBridge.run('mi-cli', 'get_prop', { props: pms })
      if (result.status === 'success' && Array.isArray(result.data)) {
        const remapped = []
        for (const v of result.data as Array<{ siid: number; piid: number; value?: unknown; code?: number }>) {
          const k = rmp[`prop.${v.siid}.${v.piid}`]
          if (!k) continue
          remapped.push({ ...v, name: k })
        }
        return { did, props: remapped }
      }
      return { did, props: [], error: (result as any).error, message: (result as any).message }
    }

    const pms = (body.props ?? []).map(p => ({ did, siid: p.siid, piid: p.piid }))
    if (pms.length === 0) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Need mapping or props' }
    }
    const result = await cliBridge.run('mi-cli', 'get_prop', { props: pms })
    if (result.status === 'success') return { did, props: result.data }
    return { did, props: [], error: (result as any).error, message: (result as any).message }
  })

  // POST /api/devices/:did/control — 对照 async_set_props / async_do_action
  app.post('/api/devices/:did/control', async (request) => {
    const { did } = request.params as { did: string }
    const body = request.body as { siid?: number; piid?: number; aiid?: number; value?: unknown; params?: unknown[] }

    if (body.aiid != null) {
      return await cliBridge.run('mi-cli', 'run_action', {
        did, siid: body.siid, aiid: body.aiid, params: body.params ?? [],
      })
    }

    if (body.piid != null && body.value !== undefined) {
      return await cliBridge.run('mi-cli', 'set_prop', {
        did, siid: body.siid, piid: body.piid, value: body.value,
      })
    }

    return { status: 'error', error: 'INVALID_PARAMS', message: 'Need siid+piid+value or siid+aiid+params' }
  })
}
