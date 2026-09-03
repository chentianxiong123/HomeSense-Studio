import { NestFactory } from '@nestjs/core'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Duplex } from 'node:stream'
import { AppModule } from './app.module'
import { initDb } from './db/database'
import { AdbScrcpyStreamGateway } from './streaming/adb-scrcpy-stream.gateway'
import { MoonlightWebRuntimeService } from './streaming/moonlight-web-runtime.service'
import { StreamingControlGateway } from './streaming/streaming-control.gateway'
import { TerminalGateway } from './terminal/terminal.gateway'

async function bootstrap() {
  initDb()
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: true })
  const moonlightRuntime = app.get(MoonlightWebRuntimeService)
  app.use('/moonlight', (req: IncomingMessage, res: ServerResponse) => {
    const originalUrl = 'originalUrl' in req ? String(req.originalUrl) : req.url || ''
    if ((req.method === 'GET' || req.method === 'HEAD') && originalUrl.match(/^\/moonlight(?:\?.*)?$/)) {
      const queryIndex = originalUrl.indexOf('?')
      const query = queryIndex >= 0 ? originalUrl.slice(queryIndex) : ''
      res.writeHead(308, { location: `/moonlight/${query}` })
      res.end()
      return
    }
    void moonlightRuntime.proxyHttp(req, res)
  })
  app.setGlobalPrefix('api')
  const port = Number(process.env.PORT) || 3100
  await app.listen(port)

  const gateway = app.get(TerminalGateway)
  const streamingControlGateway = app.get(StreamingControlGateway)
  const adbScrcpyStreamGateway = app.get(AdbScrcpyStreamGateway)
  const server = app.getHttpServer()
  gateway.attach(server)
  streamingControlGateway.attach(server)
  adbScrcpyStreamGateway.attach(server)
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    if (!req.url?.startsWith('/moonlight')) return
    void moonlightRuntime.proxyUpgrade(req, socket, head)
  })

  console.log(`Server running on http://localhost:${port}`)
}
bootstrap()
