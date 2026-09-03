import { Injectable, Logger } from '@nestjs/common'
import { cliBridge } from '../../../../modules/integration/index.js'

export interface CliRunResult<T = unknown> {
  status: 'success' | 'error'
  data?: T
  error?: string
  message?: string
  duration_ms?: number
}

/**
 * External CLI compatibility layer. Wraps the legacy cliBridge so that
 * any code that still needs to invoke a CLI executor (e.g. a third-party
 * tool we haven't replaced with a native library yet) can do so through
 * a single, well-typed surface.
 *
 * Default execution path: native services (AdbService, MiHomeService).
 * This service exists for fall-back and external-tool bridging.
 */
@Injectable()
export class CliCompatService {
  private readonly logger = new Logger(CliCompatService.name)

  async run<T = unknown>(cliName: string, action: string, params: Record<string, unknown> = {}): Promise<CliRunResult<T>> {
    const result = await cliBridge.run(cliName, action, params)
    return result as CliRunResult<T>
  }

  async runWithRetry<T = unknown>(cliName: string, action: string, params: Record<string, unknown> = {}, maxRetries = 2): Promise<CliRunResult<T>> {
    let last: CliRunResult<T> | null = null
    for (let i = 0; i <= maxRetries; i++) {
      const r = await this.run<T>(cliName, action, params)
      if (r.status === 'success') return r
      last = r
    }
    this.logger.warn(`cli ${cliName}:${action} failed after ${maxRetries + 1} attempts`)
    return last ?? { status: 'error', error: 'NO_RESULT' }
  }
}
