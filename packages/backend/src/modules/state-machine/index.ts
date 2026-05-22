import { eventBus, HeartEvent } from '../event-bus/index.js'
import { getDb as defaultGetDb } from '../../db/index.js'

export interface State {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_updated: string
}

type GetDbFn = () => ReturnType<typeof defaultGetDb>

export class StateMachine {
  private states = new Map<string, State>()

  constructor(private readonly getDb: GetDbFn = defaultGetDb) {}

  async set(entityId: string, newState: string, attributes?: Record<string, unknown>): Promise<State> {
    const now = new Date().toISOString()
    const old = this.states.get(entityId)
    const oldState = old?.state ?? 'unknown'
    const oldAttrs = old?.attributes ?? {}

    const updated: State = {
      entity_id: entityId,
      state: newState,
      attributes: attributes ?? oldAttrs,
      last_updated: now,
    }

    this.states.set(entityId, updated)

    const db = this.getDb()

    db.prepare(
      `INSERT INTO entity_states (entity_id, state, attributes_json, last_updated)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(entity_id) DO UPDATE SET
         state = excluded.state,
         attributes_json = excluded.attributes_json,
         last_updated = excluded.last_updated`,
    ).run(entityId, newState, JSON.stringify(updated.attributes), now)

    if (oldState !== newState || JSON.stringify(oldAttrs) !== JSON.stringify(updated.attributes)) {
      db.prepare(
        `INSERT INTO state_history (entity_id, old_state, new_state, old_attributes_json, new_attributes_json, changed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(entityId, oldState, newState, JSON.stringify(oldAttrs), JSON.stringify(updated.attributes), now)

      await eventBus.fire(HeartEvent.STATE_CHANGED, {
        entity_id: entityId,
        old_state: oldState,
        new_state: newState,
        attributes: updated.attributes,
      })
    }

    return updated
  }

  get(entityId: string): State | undefined {
    return this.states.get(entityId)
  }

  getAll(): State[] {
    return Array.from(this.states.values())
  }

  hydrate(): void {
    const db = this.getDb()
    const rows = db.prepare(
      'SELECT entity_id, state, attributes_json, last_updated FROM entity_states',
    ).all() as Array<{ entity_id: string; state: string; attributes_json: string; last_updated: string }>

    for (const row of rows) {
      this.states.set(row.entity_id, {
        entity_id: row.entity_id,
        state: row.state,
        attributes: JSON.parse(row.attributes_json),
        last_updated: row.last_updated,
      })
    }
  }
}

export const stateMachine = new StateMachine()