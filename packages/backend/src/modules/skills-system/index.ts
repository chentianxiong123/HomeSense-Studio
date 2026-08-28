import fs from 'fs'
import path from 'path'
import { eventBus as defaultEventBus, HeartEvent } from '../event-bus/index.js'
import { SqlSkillsRepository, type SkillsRepository } from './repository.js'

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

export interface SkillSection {
  id: string
  title: string
  level: number
  body: string
}

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

export class SkillsService {
  private readonly skills = new Map<string, SkillDefinition>()

  constructor(
    private readonly repo: SkillsRepository = new SqlSkillsRepository(),
    private readonly eventBus: EventBusInstance = defaultEventBus,
  ) {}

  /**
   * Repopulate the in-memory map from persistent storage. Should be called
   * at startup so that previously-registered skills (especially source='converted'
   * skills auto-promoted from experiences) survive a process restart.
   */
  loadAll(): number {
    this.skills.clear()
    const all = this.repo.listAllEnabled()
    for (const skill of all) {
      this.skills.set(skill.name, skill)
    }
    return all.length
  }

  register(skill: SkillDefinition): void {
    if (!skill.name) throw new Error('Skill name is required')

    this.skills.set(skill.name, skill)
    this.repo.upsertSkill(skill)
    this.eventBus.fire(HeartEvent.SKILL_REGISTERED, { name: skill.name })
  }

  getSkill(name: string): SkillDefinition | undefined {
    const cached = this.skills.get(name)
    if (cached) return cached
    // Fallback: skill may have been added by another process / not yet loaded.
    const row = this.repo.getSkill(name)
    if (row && row.enabled) {
      this.skills.set(name, row)
      return row
    }
    return undefined
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
    const skill = this.getSkill(skillName)
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

  async loadSkillSections(skillName: string): Promise<SkillSection[]> {
    const content = await this.loadFullSkill(skillName)
    return parseMarkdownSections(content)
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

function parseMarkdownSections(content: string): SkillSection[] {
  const lines = content.split(/\r?\n/)
  const sections: SkillSection[] = []
  let current: SkillSection | null = null
  const bodyLines: string[] = []

  const flush = () => {
    if (!current) return
    current.body = bodyLines.join('\n').trim()
    sections.push(current)
    bodyLines.length = 0
  }

  for (const line of lines) {
    const heading = line.match(/^(#{1,4})\s+(.+)$/)
    if (heading) {
      flush()
      const title = heading[2].trim()
      current = {
        id: slugify(title),
        title,
        level: heading[1].length,
        body: '',
      }
      continue
    }
    if (current) bodyLines.push(line)
  }

  flush()
  return sections
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[`"'：:，,。.!?？/\\()[\]{}]+/g, ' ')
    .trim()
    .replace(/\s+/g, '-')
  return slug || 'section'
}
