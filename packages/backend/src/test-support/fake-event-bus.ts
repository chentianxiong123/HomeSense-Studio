type EventHandler = (...args: unknown[]) => void

export interface RecordedEvent {
  event: string
  data?: unknown
  timestamp: number
}

export class FakeEventBus {
  readonly fired: RecordedEvent[] = []
  private readonly handlers = new Map<string, EventHandler[]>()

  fire(event: string, data?: unknown): void {
    this.fired.push({ event, data, timestamp: Date.now() })
    for (const handler of this.handlers.get(event) ?? []) {
      try { handler(data) } catch {}
    }
  }

  on(event: string, handler: EventHandler): void {
    if (!this.handlers.has(event)) this.handlers.set(event, [])
    this.handlers.get(event)!.push(handler)
  }

  reset(): void {
    this.fired.length = 0
    this.handlers.clear()
  }

  firedNames(): string[] {
    return this.fired.map((entry) => entry.event)
  }

  countOf(event: string): number {
    return this.fired.filter((entry) => entry.event === event).length
  }

  lastOf(event: string): RecordedEvent | undefined {
    return this.fired.filter((entry) => entry.event === event).at(-1)
  }
}
