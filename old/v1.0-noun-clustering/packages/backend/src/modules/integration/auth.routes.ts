import type { FastifyInstance } from 'fastify'
import { cliBridge } from './cli-bridge.js'

export async function authRoutes(app: FastifyInstance) {
  app.post('/api/auth/qr/start', async () => {
    const result = await cliBridge.run('mi-cli', 'login_qr')
    return result
  })

  app.get('/api/auth/qr/status', async () => {
    const result = await cliBridge.run('mi-cli', 'login_qr_status')
    return result
  })

  app.post('/api/auth/qr/reset', async () => {
    const result = await cliBridge.run('mi-cli', 'login_qr_reset')
    return result
  })

  app.post('/api/auth/login', async (request) => {
    const body = request.body as { username?: string; password?: string } | undefined
    const result = await cliBridge.run('mi-cli', 'login_password', {
      username: body?.username ?? '',
      password: body?.password ?? '',
    })
    return result
  })

  app.post('/api/auth/verify-ticket', async (request) => {
    const body = request.body as { ticket?: string; username?: string; password?: string } | undefined
    const result = await cliBridge.run('mi-cli', 'verify_ticket', {
      ticket: body?.ticket ?? '',
      username: body?.username ?? '',
      password: body?.password ?? '',
    })
    return result
  })

  app.get('/api/auth/status', async () => {
    const result = await cliBridge.run('mi-cli', 'login_status')
    return result
  })

  app.post('/api/auth/logout', async () => {
    const result = await cliBridge.run('mi-cli', 'login_logout')
    return result
  })
}
