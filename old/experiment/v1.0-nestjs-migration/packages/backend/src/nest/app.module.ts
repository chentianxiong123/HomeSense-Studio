import { Module } from '@nestjs/common'
import { HealthController } from './health.controller.js'
import { SettingModule } from './modules/setting/setting.module.js'
import { DeviceDiscoveryModule } from './modules/device-discovery/device-discovery.module.js'
import { UserDeviceModule } from './modules/user-device/user-device.module.js'
import { RoomModule } from './modules/room/room.module.js'
import { ContextModule } from './modules/context/context.module.js'
import { IntegrationModule } from './modules/integration/integration.module.js'

@Module({
  imports: [
    SettingModule,
    DeviceDiscoveryModule,
    UserDeviceModule,
    RoomModule,
    ContextModule,
    IntegrationModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
