type EventListener = (data: unknown) => void | Promise<void>

export class EventBus {
  private listeners = new Map<string, Set<EventListener>>()

  async fire(eventType: string, data?: unknown): Promise<void> {
    const listeners = this.listeners.get(eventType)
    if (!listeners) return

    for (const listener of listeners) {
      try {
        await listener(data)
      } catch (err) {
        console.error(`EventBus listener error for "${eventType}":`, err)
      }
    }
  }

  listen(eventType: string, listener: EventListener): () => void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set())
    }
    this.listeners.get(eventType)!.add(listener)

    return () => {
      this.listeners.get(eventType)?.delete(listener)
    }
  }
}

export const eventBus = new EventBus()
