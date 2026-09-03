import { Module } from '@nestjs/common'
import { SettingController } from './setting.controller.js'
import { SettingService } from './setting.service.js'

@Module({
  controllers: [SettingController],
  providers: [SettingService],
  exports: [SettingService],
})
export class SettingModule {}
