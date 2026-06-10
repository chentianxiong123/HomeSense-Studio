import { Module } from '@nestjs/common'
import { AlistModule } from '../alist/alist.module'
import { AdbStorageService } from './adb-storage.service'
import { StorageController } from './storage.controller'
import { StorageMountService } from './storage-mount.service'
import { StorageService } from './storage.service'
import { StorageTaskService } from './storage-task.service'
import { StorageTransferService } from './storage-transfer.service'
import { SftpStorageService } from './sftp-storage.service'

@Module({
  imports: [AlistModule],
  controllers: [StorageController],
  providers: [StorageMountService, StorageService, StorageTaskService, StorageTransferService, SftpStorageService, AdbStorageService],
  exports: [StorageMountService, StorageService],
})
export class StorageModule {}
