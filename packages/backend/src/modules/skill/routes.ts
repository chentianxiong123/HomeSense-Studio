import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index.js'
import { skillsService } from '../skills-system/index.js'

export async function skillRoutes(app: FastifyInstance) {
  app.get('/api/skills', async () => {
    const skills = skillsService.listSkills()
    return { skills }
  })

  app.get('/api/skills/:name', async (request) => {
    const { name } = request.params as { name: string }
    const skill = skillsService.getSkill(name)
    if (!skill) {
      return { status: 'error', error: 'NOT_FOUND', message: `技能 ${name} 不存在` }
    }
    return { skill }
  })

  app.get('/api/skills/:name/full', async (request) => {
    const { name } = request.params as { name: string }
    const skill = skillsService.getSkill(name)
    if (!skill) {
      return { status: 'error', error: 'NOT_FOUND', message: `技能 ${name} 不存在` }
    }
    const fullSkill = await skillsService.loadFullSkill(name)
    return { prompt_template: (fullSkill as any)?.prompt_template ?? (skill as any).prompt_template ?? '' }
  })

  app.get('/api/skills/:name/sections', async (request) => {
    const { name } = request.params as { name: string }
    const skill = skillsService.getSkill(name)
    if (!skill) {
      return { status: 'error', error: 'NOT_FOUND', message: `技能 ${name} 不存在` }
    }
    const sections = await skillsService.loadSkillSections(name)
    return { sections }
  })

  app.post('/api/skills', async (request) => {
    const body = request.body as {
      name: string
      description: string
      prompt_template?: string
      allowed_tools_json?: string
      action_schema_json?: string
      context_mode?: string
      source?: string
      skill_root?: string
      enabled?: boolean
    }
    if (!body.name || !body.description) {
      return { status: 'error', error: 'INVALID_PARAMS', message: '缺少 name/description 参数' }
    }
    skillsService.register({
      name: body.name,
      description: body.description,
      prompt_template: body.prompt_template ?? '',
      allowed_tools_json: body.allowed_tools_json ?? '["mi-cli"]',
      action_schema_json: body.action_schema_json ?? '[]',
      context_mode: (body.context_mode ?? 'inline') as 'inline' | 'fork',
      source: (body.source ?? 'manual') as 'builtin' | 'disk' | 'converted',
      skill_root: body.skill_root ?? '',
      enabled: body.enabled ?? true,
    })
    return { status: 'success', skill: skillsService.getSkill(body.name) }
  })

  app.put('/api/skills/:name', async (request) => {
    const { name } = request.params as { name: string }
    const body = request.body as Record<string, unknown>
    const db = getDb()

    const existing = db.prepare('SELECT * FROM skills WHERE name = ?').get(name)
    if (!existing) {
      return { status: 'error', error: 'NOT_FOUND' }
    }

    const updates: string[] = []
    const values: unknown[] = []
    for (const key of ['description', 'prompt_template', 'allowed_tools_json', 'action_schema_json', 'context_mode', 'enabled']) {
      if (body[key] !== undefined) {
        updates.push(`${key} = ?`)
        values.push(body[key])
      }
    }
    if (updates.length > 0) {
      values.push(name)
      db.prepare(`UPDATE skills SET ${updates.join(', ')} WHERE name = ?`).run(...values)
    }

    return { status: 'success', skill: skillsService.getSkill(name) }
  })

  app.delete('/api/skills/:name', async (request) => {
    const { name } = request.params as { name: string }
    const db = getDb()
    db.prepare('DELETE FROM skills WHERE name = ?').run(name)
    return { status: 'success' }
  })

  app.post('/api/skills/reload', async (request) => {
    const body = (request.body as { dir?: string }) ?? {}
    const dir = body.dir || process.env.SKILLS_DIR || ''
    if (dir) {
      await skillsService.loadDiskSkills(dir)
    }
    const count = skillsService.listSkills().length
    return { count }
  })
}
