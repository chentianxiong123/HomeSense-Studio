import { Module } from '@nestjs/common'
import { DeviceModule } from '../devices/device.module'
import { AdbScrcpySessionController } from './adb-scrcpy-session.controller'
import { AdbScrcpySessionService } from './adb-scrcpy-session.service'
import { AdbScrcpyStreamGateway } from './adb-scrcpy-stream.gateway'
import { StreamingControlGateway } from './streaming-control.gateway'
import { StreamingGatewayController } from './streaming-gateway.controller'
import { StreamingGatewayService } from './streaming-gateway.service'

@Module({
  imports: [DeviceModule],
  controllers: [StreamingGatewayController, AdbScrcpySessionController],
  providers: [StreamingGatewayService, StreamingControlGateway, AdbScrcpySessionService, AdbScrcpyStreamGateway],
})
export class StreamingGatewayModule {}
