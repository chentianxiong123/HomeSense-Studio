export interface A2AAgentBinding {
  endpoint_env?: string
  endpoint_url?: string
  agent_name?: string
}

export interface A2ASendParams {
  target: string
  task: string
  payload?: Record<string, unknown>
  execution_mode?: string
  binding?: A2AAgentBinding
  dry_run?: boolean
}

export interface A2ASendResult {
  protocol: 'a2a'
  status: 'planned' | 'sent'
  target: string
  endpoint?: string
  request: Record<string, unknown>
  response?: unknown
  accepted_at: string
}

export class A2AClient {
  async sendTask(params: A2ASendParams): Promise<A2ASendResult> {
    const endpoint = this.resolveEndpoint(params.binding)
    const request = this.buildMessageSendRequest(params)
    const dryRun = params.dry_run !== false || !endpoint

    if (dryRun) {
      return {
        protocol: 'a2a',
        status: 'planned',
        target: params.target,
        endpoint,
        request,
        accepted_at: new Date().toISOString(),
      }
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(`A2A request failed: ${response.status} ${JSON.stringify(body)}`)
    }

    return {
      protocol: 'a2a',
      status: 'sent',
      target: params.target,
      endpoint,
      request,
      response: body,
      accepted_at: new Date().toISOString(),
    }
  }

  private buildMessageSendRequest(params: A2ASendParams): Record<string, unknown> {
    return {
      jsonrpc: '2.0',
      id: `a2a_${Date.now()}`,
      method: 'message/send',
      params: {
        message: {
          role: 'user',
          parts: [
            {
              kind: 'text',
              text: params.task,
            },
            {
              kind: 'data',
              data: {
                target: params.target,
                execution_mode: params.execution_mode ?? 'deferred',
                payload: params.payload ?? {},
              },
            },
          ],
        },
      },
    }
  }

  private resolveEndpoint(binding?: A2AAgentBinding): string | undefined {
    const envValue = binding?.endpoint_env ? process.env[binding.endpoint_env] : undefined
    return envValue || binding?.endpoint_url || undefined
  }
}

export const a2aClient = new A2AClient()
