import { Module } from '@nestjs/common'
import { AlistModule } from '../alist/alist.module'
import { StorageController } from './storage.controller'
import { StorageMountService } from './storage-mount.service'
import { StorageService } from './storage.service'

@Module({
  imports: [AlistModule],
  controllers: [StorageController],
  providers: [StorageMountService, StorageService],
  exports: [StorageMountService, StorageService],
})
export class StorageModule {}
