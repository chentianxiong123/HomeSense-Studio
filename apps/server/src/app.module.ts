import { Module } from '@nestjs/common'
import { ConnectedServicesController } from './connected-services.controller'

@Module({
  controllers: [ConnectedServicesController],
})
export class AppModule {}
