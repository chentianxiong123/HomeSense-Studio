import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { initDb } from './db/database'
import { AdbScrcpyStreamGateway } from './streaming/adb-scrcpy-stream.gateway'
import { StreamingControlGateway } from './streaming/streaming-control.gateway'
import { TerminalGateway } from './terminal/terminal.gateway'

async function bootstrap() {
  initDb()
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: true })
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

  console.log(`Server running on http://localhost:${port}`)
}
bootstrap()
