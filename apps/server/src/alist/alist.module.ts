import { Module } from '@nestjs/common'
import { DeviceModule } from '../devices/device.module'
import { AlistAuthorizationController } from './alist-authorization.controller'
import { AlistAuthorizationService } from './alist-authorization.service'
import { AlistController } from './alist.controller'
import { AlistService } from './alist.service'

@Module({
  imports: [DeviceModule],
  controllers: [AlistController, AlistAuthorizationController],
  providers: [AlistService, AlistAuthorizationService],
  exports: [AlistService, AlistAuthorizationService],
})
export class AlistModule {}
