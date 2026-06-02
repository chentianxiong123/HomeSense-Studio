import { Module } from '@nestjs/common'
import { HealthController } from './health.controller.js'
import { SettingModule } from './modules/setting/setting.module.js'
import { DeviceDiscoveryModule } from './modules/device-discovery/device-discovery.module.js'

@Module({
  imports: [SettingModule, DeviceDiscoveryModule],
  controllers: [HealthController],
})
export class AppModule {}
