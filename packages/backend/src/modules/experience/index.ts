import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { getDb as defaultGetDb } from '../../db/index.js'
import { eventBus } from '../event-bus/index.js'
import { skillsService } from '../skills-system/index.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

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

class ExperienceService {
  constructor(
    private readonly getDb: GetDbFn = defaultGetDb,
    private readonly eventBus: EventBusInstance = eventBus,
    private readonly skillsService: SkillsServiceInstance = skillsService,
  ) {}

  writeExperience(category: string, title: string, content: string, importance: number): string {
    if (importance < 0 || importance > 1) {
      throw new Error('importance must be between 0 and 1')
    }

    const contentHash = this.computeHash(content)

    const db = this.getDb()
    const existing = db.prepare('SELECT id FROM experiences WHERE content_hash = ?').get(contentHash)
    if (existing) {
      return String((existing as { id: number }).id)
    }

    const categoryDir = path.join(EXPERIENCES_DIR, category)
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true })
    }

    const fileName = this.sanitizeFileName(title) + '.md'
    const filePath = path.join(categoryDir, fileName)

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

    fs.writeFileSync(filePath, frontmatter, 'utf-8')

    const result = db.prepare(
      `INSERT INTO experiences (category, title, file_path, content_hash, importance)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(category, title, filePath, contentHash, importance)

    try {
      db.prepare(
        `INSERT INTO experiences_fts (title, content, category) VALUES (?, ?, ?)`,
      ).run(title, content, category)
    } catch {}

    this.eventBus.fire('experience_written', { id: result.lastInsertRowid, category, title, importance })

    if (importance >= 0.7) {
      this.convertExperienceToSkill(Number(result.lastInsertRowid), category, title, content)
    }

    return String(result.lastInsertRowid)
  }

  indexExperience(filePath: string): void {
    if (!fs.existsSync(filePath)) return

    const content = fs.readFileSync(filePath, 'utf-8')
    const parsed = this.parseFrontmatter(content)
    if (!parsed.title) return

    const contentHash = this.computeHash(content)

    const db = this.getDb()
    const existing = db.prepare('SELECT id FROM experiences WHERE content_hash = ?').get(contentHash)
    if (existing) return

    const result = db.prepare(
      `INSERT INTO experiences (category, title, file_path, content_hash, importance)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      parsed.category || 'uncategorized',
      parsed.title,
      filePath,
      contentHash,
      parsed.importance ?? 0.5,
    )

    try {
      db.prepare(
        `INSERT INTO experiences_fts (title, content, category) VALUES (?, ?, ?)`,
      ).run(parsed.title, parsed.body || '', parsed.category || 'uncategorized')
    } catch {}

    this.eventBus.fire('experience_indexed', { id: result.lastInsertRowid, file_path: filePath })
  }

  indexAllExperiences(): number {
    let count = 0
    if (!fs.existsSync(EXPERIENCES_DIR)) return count

    const categories = fs.readdirSync(EXPERIENCES_DIR, { withFileTypes: true })
    for (const cat of categories) {
      if (!cat.isDirectory()) continue
      const files = fs.readdirSync(path.join(EXPERIENCES_DIR, cat.name))
      for (const file of files) {
        if (!file.endsWith('.md')) continue
        this.indexExperience(path.join(EXPERIENCES_DIR, cat.name, file))
        count++
      }
    }

    return count
  }

  recallExperiences(query: string, topK: number = 5, category?: string): Experience[] {
    const db = this.getDb()
    const results = new Map<number, Experience>()

    try {
      const ftsQuery = query.split(/\s+/).filter((w) => w.length >= 2).join(' OR ')
      if (ftsQuery) {
        let ftsSql = `SELECT e.*, rank FROM experiences e JOIN experiences_fts fts ON e.title = fts.title WHERE experiences_fts MATCH ?`
        const ftsParams: unknown[] = [ftsQuery]
        if (category) {
          ftsSql += ` AND e.category = ?`
          ftsParams.push(category)
        }
        ftsSql += ` ORDER BY rank LIMIT ?`
        ftsParams.push(topK)

        const ftsRows = db.prepare(ftsSql).all(...ftsParams) as Array<Record<string, unknown>>
        for (const row of ftsRows) {
          results.set(row.id as number, {
            id: row.id as number,
            category: row.category as string,
            title: row.title as string,
            content: this.readExperienceContent(row.file_path as string),
            importance: row.importance as number,
            file_path: row.file_path as string,
            tags: [],
          })
        }
      }
    } catch {}

    const keywords = query.split(/\s+/).filter((w) => w.length >= 2)
    if (keywords.length > 0 && results.size < topK) {
      let likeSql = `SELECT * FROM experiences WHERE `
      const likeConditions = keywords.map(() => `title LIKE ?`)
      likeSql += likeConditions.join(' OR ')
      const likeParams: unknown[] = keywords.map((w) => `%${w}%`)
      if (category) {
        likeSql += ` AND category = ?`
        likeParams.push(category)
      }
      likeSql += ` ORDER BY importance DESC LIMIT ?`
      likeParams.push(topK)

      const likeRows = db.prepare(likeSql).all(...likeParams) as Array<Record<string, unknown>>
      for (const row of likeRows) {
        if (!results.has(row.id as number)) {
          results.set(row.id as number, {
            id: row.id as number,
            category: row.category as string,
            title: row.title as string,
            content: this.readExperienceContent(row.file_path as string),
            importance: row.importance as number,
            file_path: row.file_path as string,
            tags: [],
          })
        }
      }
    }

    return Array.from(results.values())
      .sort((a, b) => b.importance - a.importance)
      .slice(0, topK)
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

    const db = this.getDb()
    const filePath = db.prepare('SELECT file_path FROM experiences WHERE id = ?').get(id) as { file_path: string } | undefined
    if (filePath) {
      this.updateFrontmatterConverted(filePath.file_path, true)
    }

    this.eventBus.fire('experience_converted_to_skill', { experience_id: id, skill_name: skillName })
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

  private readExperienceContent(filePath: string): string {
    try {
      if (!fs.existsSync(filePath)) return ''
      const content = fs.readFileSync(filePath, 'utf-8')
      const bodyStart = content.indexOf('---', content.indexOf('---') + 3)
      if (bodyStart !== -1) {
        return content.slice(bodyStart + 3).trim()
      }
      return content
    } catch {
      return ''
    }
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

  private updateFrontmatterConverted(filePath: string, converted: boolean): void {
    try {
      if (!fs.existsSync(filePath)) return
      let content = fs.readFileSync(filePath, 'utf-8')
      content = content.replace(
        /converted_to_skill:\s*(true|false)/,
        `converted_to_skill: ${converted}`,
      )
      fs.writeFileSync(filePath, content, 'utf-8')
    } catch {}
  }

  private computeHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16)
  }

  private sanitizeFileName(name: string): string {
    return name.replace(/[^a-zA-Z0-9一-鿿_-]/g, '_').slice(0, 50)
  }
}

export const experienceService = new ExperienceService()