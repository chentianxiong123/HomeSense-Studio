import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common'
import {
  externalIntegrationsService,
  type RegisterExternalIntegrationInput,
} from '../../../modules/integration/external-integrations.js'

@Injectable()
export class IntegrationService implements OnModuleInit {
  private readonly store = externalIntegrationsService

  onModuleInit(): void {
    this.store.ensureDefaults()
  }

  list() {
    return this.store.list()
  }

  register(input: RegisterExternalIntegrationInput) {
    try {
      return this.store.register(input)
    } catch (error) {
      throw new BadRequestException((error as Error).message)
    }
  }

  remove(id: number) {
    const removed = this.store.remove(id)
    if (!removed) {
      throw new NotFoundException(`External integration not found: ${id}`)
    }
  }
}
