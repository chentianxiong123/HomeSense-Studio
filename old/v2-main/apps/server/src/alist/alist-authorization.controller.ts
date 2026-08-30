import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Put } from '@nestjs/common'
import { AlistAuthorizationService } from './alist-authorization.service'
import type { CreateAlistAuthorizationInput, UpdateAlistAuthorizationInput } from './alist.types'

@Controller('alist/authorizations')
export class AlistAuthorizationController {
  constructor(private readonly authorizations: AlistAuthorizationService) {}

  @Get()
  list() {
    return this.authorizations.list()
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return { authorization: this.authorizations.get(id) }
  }

  @Post()
  create(@Body() body: CreateAlistAuthorizationInput) {
    return this.authorizations.create(body)
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: UpdateAlistAuthorizationInput) {
    return this.authorizations.update(id, body)
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.authorizations.remove(id)
  }
}
