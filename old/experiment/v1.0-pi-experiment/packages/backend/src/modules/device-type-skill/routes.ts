import type { FastifyInstance } from 'fastify'
import {
  getDeviceTypeSkill,
  listDeviceTypeSkills,
} from './service.js'

export async function deviceTypeSkillRoutes(app: FastifyInstance) {
  app.get('/api/assets/device-skills', async () => {
    return { skills: listDeviceTypeSkills() }
  })

  app.get('/api/assets/device-skills/:id', async (request) => {
    const { id } = request.params as { id: string }
    const skill = getDeviceTypeSkill(id)
    if (!skill) return { status: 'error', error: 'NOT_FOUND', message: 'Device type skill not found' }
    return { skill }
  })
}
