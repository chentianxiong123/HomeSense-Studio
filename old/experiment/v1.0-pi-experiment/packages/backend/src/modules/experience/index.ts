import crypto from 'crypto'
import { eventBus as defaultEventBus, HeartEvent } from '../event-bus/index.js'
import { skillsService as defaultSkillsService } from '../skills-system/index.js'
import { SqlExperienceRepository, type ExperienceRepository } from './repository.js'
import { FsExperienceFileStore, type ExperienceFileStore } from './file-store.js'

interface EventBusInstance {
  fire(event: string, data?: unknown): void
  on(event: string, handler: (...args: unknown[]) => void): void
}

interface SkillsServiceInstance {
  register(skill: {
    name: string
    description: string
    prompt_template: string
    allowed_tools_json: string
    action_schema_json: string
    context_mode: string
    source: string
    skill_root: string
    enabled: boolean
  }): void
}

export interface Experience {
  id: number
  category: string
  title: string
  content: string
  importance: number
  file_path: string
  tags: string[]
}

const EXPERIENCES_DIR = process.env.EXPERIENCES_DIR || './data/experiences'

export class ExperienceService {
  constructor(
    private readonly repo: ExperienceRepository = new SqlExperienceRepository(),
    private readonly files: ExperienceFileStore = new FsExperienceFileStore(EXPERIENCES_DIR),
    private readonly eventBus: EventBusInstance = defaultEventBus,
    private readonly skillsService: SkillsServiceInstance = defaultSkillsService,
  ) {}

  writeExperience(category: string, title: string, content: string, importance: number): string {
    if (importance < 0 || importance > 1) {
      throw new Error('importance must be between 0 and 1')
    }

    const contentHash = this.computeHash(content)
    const existingId = this.repo.findIdByContentHash(contentHash)
    if (existingId !== undefined) return String(existingId)

    this.files.ensureCategoryDir(category)
    const fileName = this.sanitizeFileName(title) + '.md'
    const filePath = this.files.resolveFilePath(category, fileName)

    const frontmatter = [
      '---',
      `category: ${category}`,
      `title: ${title}`,
      `importance: ${importance}`,
      `created_at: ${new Date().toISOString()}`,
      `converted_to_skill: false`,
      '---',
      '',
      content,
    ].join('\n')

    this.files.writeExperienceFile(filePath, frontmatter)

    const id = this.repo.insertExperience({ category, title, filePath, contentHash, importance })
    this.repo.insertFts({ title, content, category })

    this.eventBus.fire(HeartEvent.EXPERIENCE_WRITTEN, { id, category, title, importance })

    if (importance >= 0.7) {
      this.convertExperienceToSkill(id, category, title, content)
    }

    return String(id)
  }

  indexExperience(filePath: string): void {
    if (!this.files.fileExists(filePath)) return

    const content = this.files.readFile(filePath)
    const parsed = this.parseFrontmatter(content)
    if (!parsed.title) return

    const contentHash = this.computeHash(content)
    if (this.repo.findIdByContentHash(contentHash) !== undefined) return

    const id = this.repo.insertExperience({
      category: parsed.category || 'uncategorized',
      title: parsed.title,
      filePath,
      contentHash,
      importance: parsed.importance ?? 0.5,
    })

    this.repo.insertFts({
      title: parsed.title,
      content: parsed.body || '',
      category: parsed.category || 'uncategorized',
    })

    this.eventBus.fire(HeartEvent.EXPERIENCE_INDEXED, { id, file_path: filePath })
  }

  indexAllExperiences(): number {
    let count = 0
    for (const categoryDir of this.files.listCategoryDirs()) {
      for (const filePath of this.files.listFilesInCategory(categoryDir)) {
        this.indexExperience(filePath)
        count++
      }
    }
    return count
  }

  recallExperiences(query: string, topK: number = 5, category?: string): Experience[] {
    const results = new Map<number, Experience>()

    const ftsQuery = query.split(/\s+/).filter((w) => w.length >= 2).join(' OR ')
    if (ftsQuery) {
      const ftsRows = this.repo.searchByFts(ftsQuery, topK, category)
      for (const row of ftsRows) {
        results.set(row.id, this.toExperience(row))
      }
    }

    const keywords = query.split(/\s+/).filter((w) => w.length >= 2)
    if (keywords.length > 0 && results.size < topK) {
      const likeRows = this.repo.searchByTitleLike(keywords, topK, category)
      for (const row of likeRows) {
        if (!results.has(row.id)) results.set(row.id, this.toExperience(row))
      }
    }

    return Array.from(results.values())
      .sort((a, b) => b.importance - a.importance)
      .slice(0, topK)
  }

  private toExperience(row: { id: number; category: string; title: string; file_path: string; importance: number }): Experience {
    return {
      id: row.id,
      category: row.category,
      title: row.title,
      content: this.files.readExperienceBody(row.file_path),
      importance: row.importance,
      file_path: row.file_path,
      tags: [],
    }
  }

  private convertExperienceToSkill(id: number, category: string, title: string, content: string): void {
    const skillName = `exp_${category}_${this.sanitizeFileName(title)}`
    const actionSchemas = this.extractActionSchemas(content)

    this.skillsService.register({
      name: skillName,
      description: title,
      prompt_template: content,
      allowed_tools_json: JSON.stringify(['mi-cli']),
      action_schema_json: JSON.stringify(actionSchemas),
      context_mode: 'inline',
      source: 'converted',
      skill_root: '',
      enabled: true,
    })

    const filePath = this.repo.getFilePathById(id)
    if (filePath) {
      this.files.updateFrontmatterConverted(filePath, true)
    }

    this.eventBus.fire(HeartEvent.EXPERIENCE_CONVERTED_TO_SKILL, { experience_id: id, skill_name: skillName })
  }

  private extractActionSchemas(content: string): Array<{ action: string; description: string; params_schema: Record<string, string> }> {
    const schemas: Array<{ action: string; description: string; params_schema: Record<string, string> }> = []
    const stepRegex = /(?:\d+\.\s*)(调用|执行|使用)\s*(\S+)/g
    let match
    while ((match = stepRegex.exec(content)) !== null) {
      schemas.push({
        action: match[2],
        description: `${match[1]} ${match[2]}`,
        params_schema: {},
      })
    }
    return schemas
  }

  private parseFrontmatter(content: string): {
    category?: string
    title?: string
    importance?: number
    body?: string
  } {
    const result: { category?: string; title?: string; importance?: number; body?: string } = {}
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (fmMatch) {
      for (const line of fmMatch[1].split('\n')) {
        const kv = line.match(/^(\w+):\s*(.+)$/)
        if (kv) {
          const [, key, value] = kv
          if (key === 'category') result.category = value
          else if (key === 'title') result.title = value
          else if (key === 'importance') result.importance = parseFloat(value)
        }
      }
      const bodyStart = content.indexOf('---', content.indexOf('---') + 3)
      if (bodyStart !== -1) {
        result.body = content.slice(bodyStart + 3).trim()
      }
    }
    return result
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9一-鿿_-]/g, '_').slice(0, 50)
  }
}

export const experienceService = new ExperienceService()
