export interface State {
  entity_id: string
  state: string
  attributes: Record<string, unknown>
  last_updated: string
}

export class StateMachine {
  private states = new Map<string, State>()

  async set(entityId: string, newState: string, attributes?: Record<string, unknown>): Promise<State> {
    const old = this.states.get(entityId)
    const now = new Date().toISOString()

    const updated: State = {
      entity_id: entityId,
      state: newState,
      attributes: attributes ?? old?.attributes ?? {},
      last_updated: now,
    }

    this.states.set(entityId, updated)
    return updated
  }

  get(entityId: string): State | undefined {
    return this.states.get(entityId)
  }

  getAll(): State[] {
    return Array.from(this.states.values())
  }
}

export const stateMachine = new StateMachine()
