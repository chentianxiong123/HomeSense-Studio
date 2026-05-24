import { eventBus, HeartEvent } from '../event-bus/index.js'

export interface State {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_updated: string
}

export class StateMachine {
  private states = new Map<string, State>()

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

    if (oldState !== newState || JSON.stringify(oldAttrs) !== JSON.stringify(updated.attributes)) {
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
    // In-memory only; persistence will be re-added later.
  }
}

export const stateMachine = new StateMachine()