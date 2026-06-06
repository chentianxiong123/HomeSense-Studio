import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module'
import { ConnectedServicesController } from './connected-services.controller'
import { DeviceModule } from './devices/device.module'
import { HealthController } from './health.controller'

@Module({
  imports: [AuthModule, DeviceModule],
  controllers: [ConnectedServicesController, HealthController],
})
export class AppModule {}
