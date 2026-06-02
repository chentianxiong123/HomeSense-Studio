import 'reflect-metadata'
import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import { AppModule } from './nest/app.module.js'

const port = Number(process.env.NEST_PORT) || 3100
const host = '0.0.0.0'

async function start() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: true }),
    { bodyParser: false },
  )

  // Re-enable body parsers (NestJS 11 default is bodyParser: false on Fastify).
  app.useBodyParser('application/json')
  app.useBodyParser('application/x-www-form-urlencoded')

  try {
    await app.listen(port, host)
    // eslint-disable-next-line no-console
    console.log(`[nest] HomeSense NestJS pilot running on http://${host}:${port}`)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[nest] failed to start', err)
    process.exit(1)
  }
}

start()
