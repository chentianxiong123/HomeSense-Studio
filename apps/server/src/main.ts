import { NestFactory } from '@nestjs/core'
import { AppModule } from './app.module'
import { initDb } from './db/database'

async function bootstrap() {
  initDb()
  const app = await NestFactory.create(AppModule)
  app.enableCors({ origin: true })
  app.setGlobalPrefix('api')
  await app.listen(3000)
  console.log('Server running on http://localhost:3000')
}
bootstrap()
