import { Module } from '@nestjs/common'
import { MediaController } from './media.controller'
import { MediaService } from './media.service'
import { VirtualDlnaController } from './virtual-dlna.controller'
import { VirtualDlnaService } from './virtual-dlna.service'

@Module({
  controllers: [MediaController, VirtualDlnaController],
  providers: [MediaService, VirtualDlnaService],
})
export class MediaModule {}
