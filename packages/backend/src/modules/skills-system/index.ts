import fs from 'fs'
import path from 'path'
import { getDb as defaultGetDb } from '../../db/index.js'
import { eventBus } from '../event-bus/index.js'

export interface SkillDefinition {
  name: string
  description: string
  prompt_template: string
  allowed_tools_json: string
  action_schema_json: string
  context_mode: 'inline' | 'fork'
  source: 'builtin' | 'disk' | 'converted'
  skill_root: string
  enabled: boolean
}

type GetDbFn = () => ReturnType<typeof defaultGetDb>

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

class SkillsService {
  private readonly skills = new Map<string, SkillDefinition>()

  constructor(
    private readonly getDb: GetDbFn = defaultGetDb,
    private readonly eventBus: EventBusInstance = eventBus,
  ) {}

  register(skill: SkillDefinition): void {
    if (!skill.name) throw new Error('Skill name is required')

    this.skills.set(skill.name, skill)

    const db = this.getDb()
    db.prepare(
      `INSERT INTO skills (name, description, prompt_template, allowed_tools_json, action_schema_json, context_mode, source, skill_root, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET description=excluded.description, prompt_template=excluded.prompt_template,
       allowed_tools_json=excluded.allowed_tools_json, action_schema_json=excluded.action_schema_json,
       context_mode=excluded.context_mode, source=excluded.source, skill_root=excluded.skill_root, enabled=excluded.enabled`,
    ).run(
      skill.name, skill.description, skill.prompt_template,
      skill.allowed_tools_json, skill.action_schema_json,
      skill.context_mode, skill.source, skill.skill_root,
      skill.enabled ? 1 : 0,
    )

    this.eventBus.fire('skill_registered', { name: skill.name })
  }

  getSkill(name: string): SkillDefinition | undefined {
    return this.skills.get(name)
  }

  listSkills(): SkillDefinition[] {
    return Array.from(this.skills.values())
  }

  async loadDiskSkills(skillsDir: string): Promise<void> {
    if (!fs.existsSync(skillsDir)) return

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue

      try {
        const content = fs.readFileSync(skillMdPath, 'utf-8')
        const parsed = this.parseSkillMd(content)

        this.register({
          name: parsed.name || entry.name,
          description: parsed.description || '',
          prompt_template: '',
          allowed_tools_json: JSON.stringify(parsed.allowed_tools ?? []),
          action_schema_json: JSON.stringify(parsed.action_schemas ?? []),
          context_mode: parsed.context_mode || 'inline',
          source: 'disk',
          skill_root: path.join(skillsDir, entry.name),
          enabled: true,
        })
      } catch {}
    }
  }

  async loadFullSkill(skillName: string): Promise<string> {
    const skill = this.skills.get(skillName)
    if (!skill) throw new Error(`Skill not found: ${skillName}`)

    if (skill.prompt_template) return skill.prompt_template

    if (skill.skill_root) {
      const skillMdPath = path.join(skill.skill_root, 'SKILL.md')
      if (fs.existsSync(skillMdPath)) {
        const content = fs.readFileSync(skillMdPath, 'utf-8')
        const bodyStart = content.indexOf('---', content.indexOf('---') + 3)
        if (bodyStart !== -1) {
          const body = content.slice(bodyStart + 3).trim()
          skill.prompt_template = body
          return body
        }
      }
    }

    return skill.description
  }

  private parseSkillMd(content: string): {
    name?: string
    description?: string
    allowed_tools?: string[]
    context_mode?: 'inline' | 'fork'
    action_schemas?: Array<{ action: string; description: string; params_schema: Record<string, string> }>
  } {
    const result: {
      name?: string
      description?: string
      allowed_tools?: string[]
      context_mode?: 'inline' | 'fork'
      action_schemas?: Array<{ action: string; description: string; params_schema: Record<string, string> }>
    } = {}

    const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (frontmatterMatch) {
      const fm = frontmatterMatch[1]
      const lines = fm.split(/\r?\n/)
      let currentListKey: string | null = null

      for (const rawLine of lines) {
        const line = rawLine.trim()
        const kvMatch = line.match(/^(\w+):\s*(.*)$/)
        if (kvMatch) {
          const [, key, rawValue] = kvMatch
          const value = rawValue.trim()
          currentListKey = value === '' ? key : null

          if (key === 'name' && value) result.name = value
          else if (key === 'description' && value) result.description = value.replace(/^"|"$/g, '')
          else if (key === 'allowed_tools') {
            if (value.startsWith('[') && value.endsWith(']')) {
              result.allowed_tools = value
                .replace(/[\[\]]/g, '')
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            } else if (!result.allowed_tools) {
              result.allowed_tools = []
            }
          } else if (key === 'context_mode' && (value === 'inline' || value === 'fork')) {
            result.context_mode = value
          }
          continue
        }

        const listItemMatch = line.match(/^-\s+(.+)$/)
        if (listItemMatch && currentListKey === 'allowed_tools') {
          if (!result.allowed_tools) result.allowed_tools = []
          result.allowed_tools.push(listItemMatch[1].trim())
        }
      }
    }

    const actionSchemas: Array<{ action: string; description: string; params_schema: Record<string, string> }> = []
    const actionsBlockMatch = content.match(/## Actions\r?\n([\s\S]*?)(?:\r?\n## |\s*$)/)
    const actionsBlock = actionsBlockMatch?.[1] ?? ''
    const sections = actionsBlock.split(/^###\s+/m).slice(1)

    for (const section of sections) {
      const [headingLine, ...bodyLines] = section.split('\n')
      const heading = headingLine.trim()
      const body = bodyLines.join('\n')

      const directDescriptionMatch = body.match(/描述:\s*(.+)/)
      if (directDescriptionMatch && /^\w+$/.test(heading)) {
        actionSchemas.push({
          action: heading,
          description: directDescriptionMatch[1].trim(),
          params_schema: {},
        })
        continue
      }

      const tableRows = body
        .split('\n')
        .filter((line) => line.trim().startsWith('|'))
        .map((line) => line.trim())

      if (tableRows.length >= 3 && tableRows[0].includes('Action') && tableRows[0].includes('描述')) {
        for (const row of tableRows.slice(2)) {
          const cells = row
            .split('|')
            .map((cell) => cell.trim())
            .filter(Boolean)

          if (cells.length < 2) continue

          const action = cells[0].replace(/`/g, '').trim()
          const description = cells[1].trim()
          const params = cells[2]?.trim()

          if (!action || /^-+$/.test(action)) continue

          actionSchemas.push({
            action,
            description,
            params_schema: params && params !== '无'
              ? Object.fromEntries(
                  params
                    .split(',')
                    .map((param) => param.trim().replace(/\?$/, ''))
                    .filter(Boolean)
                    .map((param) => [param, 'string']),
                )
              : {},
          })
        }
      }
    }

    result.action_schemas = actionSchemas
    return result
  }
}

export const skillsService = new SkillsService()
