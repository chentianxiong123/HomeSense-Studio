import { Module } from '@nestjs/common'
import { AdbScrcpySessionController } from './adb-scrcpy-session.controller'
import { AdbScrcpySessionService } from './adb-scrcpy-session.service'
import { AdbScrcpyStreamGateway } from './adb-scrcpy-stream.gateway'
import { StreamingControlGateway } from './streaming-control.gateway'
import { StreamingGatewayController } from './streaming-gateway.controller'
import { StreamingGatewayService } from './streaming-gateway.service'
import { MoonlightWebRuntimeService } from './moonlight-web-runtime.service'

@Module({
  controllers: [StreamingGatewayController, AdbScrcpySessionController],
  providers: [StreamingGatewayService, MoonlightWebRuntimeService, StreamingControlGateway, AdbScrcpySessionService, AdbScrcpyStreamGateway],
})
export class StreamingGatewayModule {}
