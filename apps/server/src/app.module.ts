import { Module } from '@nestjs/common'
import { AlistModule } from './alist/alist.module'
import { AuthModule } from './auth/auth.module'
import { CliPassthroughController } from './cli/cli-passthrough.controller'
import { ConnectedServicesController } from './connected-services.controller'
import { DeviceModule } from './devices/device.module'
import { HealthController } from './health.controller'
import { MediaModule } from './media/media.module'
import { ResourcesModule } from './resources/resources.module'
import { StreamingGatewayModule } from './streaming/streaming-gateway.module'
import { StorageModule } from './storage/storage.module'
import { TerminalModule } from './terminal/terminal.module'

@Module({
  imports: [AuthModule, DeviceModule, TerminalModule, MediaModule, ResourcesModule, StreamingGatewayModule, AlistModule, StorageModule],
  controllers: [ConnectedServicesController, CliPassthroughController, HealthController],
})
export class AppModule {}
