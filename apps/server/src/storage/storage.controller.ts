import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import type { AlistCopyInput, AlistGetInput, AlistListInput, AlistRemoveInput } from '../alist/alist.types'
import { StorageMountService } from './storage-mount.service'
import { StorageService } from './storage.service'
import type { CreateStorageMountInput, UpdateStorageMountInput } from './storage.types'

@Controller('storage')
export class StorageController {
  constructor(
    private readonly mounts: StorageMountService,
    private readonly storage: StorageService,
  ) {}

  @Get('mounts')
  listMounts() {
    return this.mounts.list()
  }

  @Post('mounts')
  createMount(@Body() body: CreateStorageMountInput) {
    return this.mounts.create(body)
  }

  @Put('mounts/:id')
  updateMount(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateStorageMountInput) {
    return this.mounts.update(id, body)
  }

  @Delete('mounts/:id')
  removeMount(@Param('id', ParseIntPipe) id: number) {
    return this.mounts.remove(id)
  }

  @Get('health')
  health() {
    return this.storage.health()
  }

  @Post('fs/list')
  list(@Body() body: AlistListInput) {
    return this.storage.list(body)
  }

  @Post('fs/get')
  get(@Body() body: AlistGetInput) {
    return this.storage.get(body)
  }

  @Post('fs/remove')
  remove(@Body() body: AlistRemoveInput) {
    return this.storage.remove(body)
  }

  @Post('fs/copy')
  copy(@Body() body: AlistCopyInput) {
    return this.storage.copy(body)
  }
}
