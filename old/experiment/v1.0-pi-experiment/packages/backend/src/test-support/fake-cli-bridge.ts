interface CliCall {
  cli: string
  action: string
  params: Record<string, unknown>
  timestamp: number
}

interface CliResult {
  status: 'success' | 'error'
  data?: unknown
  error?: string
}

type CliResponder = (cli: string, action: string, params: Record<string, unknown>) => CliResult | Promise<CliResult>

export class FakeCliBridge {
  readonly calls: CliCall[] = []
  private responders = new Map<string, CliResponder>()
  private defaultResponder: CliResponder = () => ({ status: 'success', data: { ok: true } })

  setResponder(key: string, responder: CliResponder): void {
    this.responders.set(key, responder)
  }

  setDefaultResponder(responder: CliResponder): void {
    this.defaultResponder = responder
  }

  async run(cli: string, action: string, params: Record<string, unknown>): Promise<CliResult> {
    this.calls.push({ cli, action, params, timestamp: Date.now() })
    const key = `${cli}.${action}`
    const responder = this.responders.get(key) ?? this.defaultResponder
    return await responder(cli, action, params)
  }

  reset(): void {
    this.calls.length = 0
    this.responders.clear()
    this.defaultResponder = () => ({ status: 'success', data: { ok: true } })
  }

  callsOf(cli: string, action: string): CliCall[] {
    return this.calls.filter((call) => call.cli === cli && call.action === action)
  }
}
