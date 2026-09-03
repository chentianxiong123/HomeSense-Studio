import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post } from '@nestjs/common'
import type { RegisterExternalIntegrationInput } from '../../../modules/integration/external-integrations.js'
import { IntegrationService } from './integration.service.js'

@Controller('api/external-integrations')
export class IntegrationController {
  constructor(private readonly svc: IntegrationService) {}

  @Get()
  list() {
    return { integrations: this.svc.list() }
  }

  @Post()
  register(@Body() body: RegisterExternalIntegrationInput) {
    return { status: 'success', integration: this.svc.register(body ?? {}) }
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    this.svc.remove(id)
    return { status: 'success' }
  }
}
