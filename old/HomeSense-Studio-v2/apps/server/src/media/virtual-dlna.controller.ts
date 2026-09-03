import { Controller, Get, Header, Param, Post, Req, Res } from '@nestjs/common'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { VirtualDlnaService } from './virtual-dlna.service'

@Controller('media/virtual-dlna')
export class VirtualDlnaController {
  constructor(private readonly virtualDlna: VirtualDlnaService) {}

  @Get()
  listRenderers() {
    return this.virtualDlna.listRenderers()
  }

  @Post('refresh')
  refreshRenderers() {
    return this.virtualDlna.refreshRenderers()
  }

  @Get('device/:udn/description.xml')
  @Header('content-type', 'text/xml; charset=utf-8')
  deviceDescription(@Param('udn') udn: string, @Res() res: ServerResponse) {
    const body = this.virtualDlna.deviceDescription(udn)
    if (!body) {
      res.statusCode = 404
      res.end('Renderer not found')
      return
    }
    res.end(body)
  }

  @Get('device/:udn/:service.xml')
  @Header('content-type', 'text/xml; charset=utf-8')
  serviceScpd(@Param('service') service: string, @Res() res: ServerResponse) {
    const body = this.virtualDlna.serviceScpd(service)
    if (!body) {
      res.statusCode = 404
      res.end('Service not found')
      return
    }
    res.end(body)
  }

  @Post('device/:udn/:service/control')
  async control(
    @Param('udn') udn: string,
    @Param('service') service: string,
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ) {
    const body = await readBody(req)
    const result = await this.virtualDlna.handleSoap(udn, service, String(req.headers.soapaction || ''), body)
    res.statusCode = result.statusCode
    res.setHeader('content-type', 'text/xml; charset=utf-8')
    res.end(result.body)
  }

  @Post('device/:udn/:service/event')
  event(@Res() res: ServerResponse) {
    res.statusCode = 200
    res.setHeader('content-type', 'text/xml; charset=utf-8')
    res.end('')
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}
