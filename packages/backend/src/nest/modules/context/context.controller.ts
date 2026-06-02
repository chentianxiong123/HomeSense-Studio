import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common'
import { ContextService } from './context.service.js'

@Controller('api')
export class ContextController {
  constructor(private readonly ctx: ContextService) {}

  @Get('user-context')
  listUserContext() {
    const entries = this.ctx.listUserContext()
    const context: Record<string, { value: string; updated_at: string }> = {}
    for (const row of entries) {
      context[row.key] = { value: row.value, updated_at: row.updated_at }
    }
    return { context }
  }

  @Put('user-context/:key')
  setUserContext(@Param('key') key: string, @Body() body: { value?: string }) {
    return this.ctx.setUserContext(key, body?.value ?? '')
  }

  @Get('runtime-context')
  getRuntimeContext(
    @Query('conversationId') conversationId?: string,
    @Query('limit') limit?: string,
  ) {
    const resolvedConversationId = Number.parseInt(conversationId ?? '1', 10)
    const resolvedLimit = Number.parseInt(limit ?? '50', 10)
    return {
      context: this.ctx.getRuntimeContextWindow(
        Number.isFinite(resolvedConversationId) ? resolvedConversationId : 1,
        Number.isFinite(resolvedLimit) ? resolvedLimit : 50,
      ),
    }
  }

  @Get('runtime-context/settings')
  getRuntimeSettings() {
    return { settings: this.ctx.getRuntimeSettings() }
  }

  @Put('runtime-context/settings')
  updateRuntimeSettings(
    @Body()
    body: {
      max_turns?: number
      ttl_ms?: number
      retrieval_limit?: number
      context_token_budget?: number
    },
  ) {
    return { status: 'ok', settings: this.ctx.updateRuntimeSettings(body ?? {}) }
  }
}
