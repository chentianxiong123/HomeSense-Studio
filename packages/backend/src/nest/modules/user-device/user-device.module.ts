import { Module } from '@nestjs/common'
import { UserDeviceController } from './user-device.controller.js'
import { UserDeviceService } from './user-device.service.js'

@Module({
  controllers: [UserDeviceController],
  providers: [UserDeviceService],
  exports: [UserDeviceService],
})
export class UserDeviceModule {}
