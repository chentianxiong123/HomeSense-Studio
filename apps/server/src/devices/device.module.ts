import { Module } from '@nestjs/common'
import { DeviceController } from './device.controller'
import { DeviceGroupController } from './device-group.controller'
import { DeviceGroupService } from './device-group.service'
import { DeviceService } from './device.service'
import { RoomController } from './room.controller'
import { RoomService } from './room.service'

@Module({
  controllers: [DeviceController, DeviceGroupController, RoomController],
  providers: [DeviceService, DeviceGroupService, RoomService],
  exports: [DeviceService, DeviceGroupService, RoomService],
})
export class DeviceModule {}

