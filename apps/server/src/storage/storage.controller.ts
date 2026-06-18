import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put, Query, Req, Res } from '@nestjs/common'
import type { AlistCopyInput, AlistGetInput, AlistListInput, AlistRemoveInput } from '../alist/alist.types'
import { StorageMountService } from './storage-mount.service'
import { STORAGE_PROTOCOLS } from './storage-protocols'
import { StorageService } from './storage.service'
import { StorageTaskService } from './storage-task.service'
import { StorageTransferService } from './storage-transfer.service'
import type { CreateStorageMountInput, UpdateStorageMountInput } from './storage.types'
import { DeviceService } from '../devices/device.service'

@Controller('storage')
export class StorageController {
  constructor(
    private readonly mounts: StorageMountService,
    private readonly storage: StorageService,
    private readonly tasks: StorageTaskService,
    private readonly transfers: StorageTransferService,
    private readonly devices: DeviceService,
  ) {}

  @Get('mounts')
  listMounts() {
    return this.mounts.list()
  }

  @Get('devices/:id/files-entry')
  ensureDeviceFilesEntry(@Param('id', ParseIntPipe) id: number) {
    const device = this.devices.get(id)
    const { mount } = this.mounts.ensureDeviceSftpMount({
      deviceId: id,
      deviceName: device.name,
      props: device.props ?? {},
    })
    return { mount, path: mount.virtual_path }
  }

  @Get('protocols')
  listProtocols() {
    return { protocols: STORAGE_PROTOCOLS }
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

  @Get('tasks')
  listTasks() {
    return this.tasks.list()
  }

  @Get('tasks/:id')
  getTask(@Param('id') id: string) {
    return { task: this.tasks.get(id) }
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

  @Post('fs/copy-task')
  copyTask(@Body() body: AlistCopyInput) {
    return { task: this.storage.copyTask(body) }
  }

  @Post('fs/mkdir')
  mkdir(@Body() body: { path?: string }) {
    return this.storage.mkdir(body.path ?? '')
  }

  @Get('fs/download')
  async download(@Query('path') rawPath: string, @Res() res: any) {
    const name = String(rawPath || '').split('/').filter(Boolean).at(-1) || 'download'
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(name)}"`)
    await this.transfers.download(rawPath, res)
  }

  @Put('fs/upload')
  upload(@Query('path') rawPath: string, @Req() req: any) {
    return this.transfers.upload(rawPath, req)
  }
}
