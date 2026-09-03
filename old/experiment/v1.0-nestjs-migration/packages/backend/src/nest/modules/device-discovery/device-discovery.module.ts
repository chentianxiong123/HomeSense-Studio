import { Module } from '@nestjs/common'
import { DeviceDiscoveryController } from './device-discovery.controller.js'
import { DeviceDiscoveryService } from './device-discovery.service.js'
import { AdbService } from './services/adb.service.js'
import { MiHomeService } from './services/mi-home.service.js'
import { CliCompatService } from './external/cli-compat.service.js'

@Module({
  controllers: [DeviceDiscoveryController],
  providers: [AdbService, MiHomeService, CliCompatService, DeviceDiscoveryService],
  exports: [AdbService, MiHomeService, CliCompatService, DeviceDiscoveryService],
})
export class DeviceDiscoveryModule {}
