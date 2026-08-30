import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post } from '@nestjs/common'
import { ResourcesService } from './resources.service'
import type { ResourceNormalizeInput, ResourceSearchInput, ResourceSourceInput } from './resources.types'

@Controller('resources')
export class ResourcesController {
  constructor(private readonly resources: ResourcesService) {}

  @Get('sources')
  listSources() {
    return this.resources.listSources()
  }

  @Post('sources')
  createSource(@Body() body: ResourceSourceInput) {
    return this.resources.createSource(body)
  }

  @Patch('sources/:sourceId')
  updateSource(@Param('sourceId', ParseIntPipe) sourceId: number, @Body() body: ResourceSourceInput) {
    return this.resources.updateSource(sourceId, body)
  }

  @Delete('sources/:sourceId')
  removeSource(@Param('sourceId', ParseIntPipe) sourceId: number) {
    return this.resources.removeSource(sourceId)
  }

  @Post('sources/:sourceId/test')
  testSource(@Param('sourceId', ParseIntPipe) sourceId: number, @Body() body: ResourceSearchInput) {
    return this.resources.testSource(sourceId, body)
  }

  @Post('search')
  search(@Body() body: ResourceSearchInput) {
    return this.resources.search(body)
  }

  @Post('normalize')
  normalize(@Body() body: ResourceNormalizeInput) {
    return this.resources.normalize(body)
  }
}
