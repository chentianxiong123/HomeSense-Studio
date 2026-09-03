import { getDb as defaultGetDb } from '../../db/index.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

export interface ExperienceRow {
  id: number
  category: string
  title: string
  file_path: string
  content_hash: string
  importance: number
  created_at: string
}

export interface ExperienceRepository {
  findIdByContentHash(contentHash: string): number | undefined
  insertExperience(input: {
    category: string
    title: string
    filePath: string
    contentHash: string
    importance: number
  }): number
  getFilePathById(id: number): string | undefined
  insertFts(input: { title: string; content: string; category: string }): void
  searchByFts(query: string, topK: number, category: string | undefined): ExperienceRow[]
  searchByTitleLike(keywords: string[], topK: number, category: string | undefined): ExperienceRow[]
}

export class SqlExperienceRepository implements ExperienceRepository {
  constructor(private readonly getDb: GetDbFn = defaultGetDb) {}

  findIdByContentHash(contentHash: string): number | undefined {
    const row = this.getDb()
      .prepare('SELECT id FROM experiences WHERE content_hash = ?')
      .get(contentHash) as { id: number } | undefined
    return row ? row.id : undefined
  }

  insertExperience(input: {
    category: string
    title: string
    filePath: string
    contentHash: string
    importance: number
  }): number {
    const result = this.getDb()
      .prepare(
        `INSERT INTO experiences (category, title, file_path, content_hash, importance)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(input.category, input.title, input.filePath, input.contentHash, input.importance)
    return Number(result.lastInsertRowid)
  }

  getFilePathById(id: number): string | undefined {
    const row = this.getDb()
      .prepare('SELECT file_path FROM experiences WHERE id = ?')
      .get(id) as { file_path: string } | undefined
    return row ? row.file_path : undefined
  }

  insertFts(input: { title: string; content: string; category: string }): void {
    try {
      this.getDb()
        .prepare(`INSERT INTO experiences_fts (title, content, category) VALUES (?, ?, ?)`)
        .run(input.title, input.content, input.category)
    } catch {}
  }

  searchByFts(query: string, topK: number, category: string | undefined): ExperienceRow[] {
    try {
      let sql = `SELECT e.*, rank FROM experiences e JOIN experiences_fts fts ON e.title = fts.title WHERE experiences_fts MATCH ?`
      const params: unknown[] = [query]
      if (category) {
        sql += ` AND e.category = ?`
        params.push(category)
      }
      sql += ` ORDER BY rank LIMIT ?`
      params.push(topK)
      return this.getDb().prepare(sql).all(...params) as ExperienceRow[]
    } catch {
      return []
    }
  }

  searchByTitleLike(keywords: string[], topK: number, category: string | undefined): ExperienceRow[] {
    if (keywords.length === 0) return []
    let sql = `SELECT * FROM experiences WHERE `
    sql += keywords.map(() => 'title LIKE ?').join(' OR ')
    const params: unknown[] = keywords.map((w) => `%${w}%`)
    if (category) {
      sql += ` AND category = ?`
      params.push(category)
    }
    sql += ` ORDER BY importance DESC LIMIT ?`
    params.push(topK)
    return this.getDb().prepare(sql).all(...params) as ExperienceRow[]
  }
}
