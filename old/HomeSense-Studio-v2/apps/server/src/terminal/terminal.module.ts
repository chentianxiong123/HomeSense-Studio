import { Module, OnModuleDestroy } from '@nestjs/common'
import { TerminalGateway, TerminalController } from './terminal.gateway'
import { SessionStore } from './session.store'
import { DeviceModule } from '../devices/device.module'

@Module({
  imports: [DeviceModule],
  controllers: [TerminalController],
  providers: [TerminalGateway],
})
export class TerminalModule implements OnModuleDestroy {
  onModuleDestroy() {
    SessionStore.shutdownAll()
  }
}
