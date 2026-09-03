import { Module } from '@nestjs/common'
import { DeviceModule } from '../devices/device.module'
import { AlistAuthorizationController } from './alist-authorization.controller'
import { AlistAuthorizationService } from './alist-authorization.service'
import { AlistController } from './alist.controller'
import { AlistSidecarService } from './alist-sidecar.service'
import { AlistService } from './alist.service'

@Module({
  imports: [DeviceModule],
  controllers: [AlistController, AlistAuthorizationController],
  providers: [AlistService, AlistAuthorizationService, AlistSidecarService],
  exports: [AlistService, AlistAuthorizationService, AlistSidecarService],
})
export class AlistModule {}
