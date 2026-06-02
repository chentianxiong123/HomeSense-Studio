import { Module } from '@nestjs/common'
import { HealthController } from './health.controller.js'
import { SettingModule } from './modules/setting/setting.module.js'

@Module({
  imports: [SettingModule],
  controllers: [HealthController],
})
export class AppModule {}
