import { getDb as defaultGetDb } from '../../db/index.js'
import { cliBridge, type CLIBridge } from '../cli-bridge/index.js'
import { eventBus } from '../event-bus/index.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface PollResult {
  did: string
  success: boolean
  states: Record<string, { state: string; attributes: Record<string, unknown> }>
}

export class DeviceStatePoller {
  private timer: ReturnType<typeof setInterval> | null = null
  private intervalMs: number = 30000
  private running = false

  constructor(
    private readonly getDb: GetDbFn = defaultGetDb,
    private readonly cliBridge: CLIBridge = cliBridge,
    private readonly eventBus: EventBusInstance = eventBus,
  ) {}

  start(intervalMs: number = 30000): void {
    if (this.timer) return
    this.intervalMs = intervalMs
    this.running = true

    this.poll()
    this.timer = setInterval(() => this.poll(), this.intervalMs)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.running = false
  }

  isRunning(): boolean {
    return this.running
  }

  async pollDevice(did: string): Promise<PollResult> {
    const result: PollResult = { did, success: false, states: {} }

    const db = this.getDb()
    const entities = db
      .prepare('SELECT entity_id, domain, capability FROM entities WHERE device_did = ? AND enabled = 1')
      .all(did) as Array<{ entity_id: string; domain: string; capability: string }>

    if (entities.length === 0) {
      result.success = true
      return result
    }

    const features = db
      .prepare('SELECT siid, piid, type, name FROM device_features WHERE device_did = ? AND type = ?')
      .all(did, 'property') as Array<{ siid: number; piid: number; type: string; name: string }>

    if (features.length === 0) {
      result.success = true
      return result
    }

    const props = features.map((f) => ({ did, siid: f.siid, piid: f.piid }))
    const cliResult = await this.cliBridge.run('mi-cli', 'get_prop', { props })

    if (cliResult.status === 'error') {
      for (const entity of entities) {
        result.states[entity.entity_id] = { state: 'unavailable', attributes: {} }
      }
      return result
    }

    result.success = true
    const propValues = Array.isArray(cliResult.data) ? cliResult.data : [cliResult.data]

    for (const entity of entities) {
      const entityState = this.computeEntityState(entity, features, propValues)
      result.states[entity.entity_id] = entityState
    }

    return result
  }

  private computeEntityState(
    entity: { entity_id: string; domain: string; capability: string },
    features: Array<{ siid: number; piid: number; name: string }>,
    propValues: Array<Record<string, unknown>>,
  ): { state: string; attributes: Record<string, unknown> } {
    const attributes: Record<string, unknown> = {}

    for (const pv of propValues) {
      if (pv.get && typeof pv.get === 'function') continue
      const siid = Number(pv.siid ?? 0)
      const piid = Number(pv.piid ?? 0)
      const value = pv.value
      const feat = features.find((f) => f.siid === siid && f.piid === piid)
      if (feat && feat.name) {
        attributes[feat.name] = value
      }
    }

    let state = 'unknown'
    if (entity.capability === 'power') {
      state = attributes.on === true || attributes.on === 1 ? 'on' : 'off'
    } else if (entity.domain === 'sensor') {
      const vals = Object.values(attributes)
      state = vals.length > 0 ? String(vals[0]) : 'unknown'
    } else if (entity.capability === 'brightness') {
      state = attributes.brightness != null ? String(attributes.brightness) : 'unknown'
    } else if (entity.capability === 'target_temperature') {
      state = attributes.target_temperature != null ? String(attributes.target_temperature) : 'unknown'
    }

    return { state, attributes }
  }

  private async poll(): Promise<void> {
    const db = this.getDb()
    const devices = db
      .prepare('SELECT did FROM devices')
      .all() as Array<{ did: string }>

    for (const device of devices) {
      try {
        const result = await this.pollDevice(device.did)
        if (!result.success) continue

        for (const [entityId, newState] of Object.entries(result.states)) {
          const existing = db
            .prepare('SELECT state, attributes_json FROM entity_states WHERE entity_id = ?')
            .get(entityId) as { state: string; attributes_json: string } | undefined

          const oldState = existing?.state ?? 'unknown'
          const oldAttrs = existing?.attributes_json ?? '{}'

          if (oldState !== newState.state || oldAttrs !== JSON.stringify(newState.attributes)) {
            db.prepare(
              `INSERT INTO entity_states (entity_id, state, attributes_json, last_updated) VALUES (?, ?, ?, datetime('now'))
               ON CONFLICT(entity_id) DO UPDATE SET state=excluded.state, attributes_json=excluded.attributes_json, last_updated=datetime('now')`,
            ).run(entityId, newState.state, JSON.stringify(newState.attributes))

            db.prepare(
              `INSERT INTO state_history (entity_id, old_state, new_state, old_attributes_json, new_attributes_json, changed_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            ).run(entityId, oldState, newState.state, oldAttrs, JSON.stringify(newState.attributes))

            await this.eventBus.fire('state_changed', {
              entity_id: entityId,
              old_state: oldState,
              new_state: newState.state,
              attributes: newState.attributes,
            })
          }
        }

        db.prepare("UPDATE devices SET last_seen = datetime('now') WHERE did = ?").run(device.did)
      } catch {
        continue
      }
    }
  }
}

export const deviceStatePoller = new DeviceStatePoller()
