import { Module } from '@nestjs/common'
import { DeviceController } from './device.controller'
import { DeviceService } from './device.service'
import { RoomController } from './room.controller'
import { RoomService } from './room.service'

@Module({
  controllers: [DeviceController, RoomController],
  providers: [DeviceService, RoomService],
  exports: [DeviceService, RoomService],
})
export class DeviceModule {}

