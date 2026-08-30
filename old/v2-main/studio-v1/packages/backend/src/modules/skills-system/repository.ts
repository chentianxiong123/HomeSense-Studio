import { getDb as defaultGetDb } from '../../db/index.js'
import type { SkillDefinition } from './index.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

export interface SkillsRepository {
  upsertSkill(skill: SkillDefinition): void
  getSkill(name: string): SkillDefinition | undefined
  listAllEnabled(): SkillDefinition[]
  listBySource(source: SkillDefinition['source']): SkillDefinition[]
  countAll(): number
}

export class SqlSkillsRepository implements SkillsRepository {
  constructor(private readonly getDb: GetDbFn = defaultGetDb) {}

  upsertSkill(skill: SkillDefinition): void {
    this.getDb()
      .prepare(
        `INSERT INTO skills (name, description, prompt_template, allowed_tools_json, action_schema_json, context_mode, source, skill_root, enabled)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET description=excluded.description, prompt_template=excluded.prompt_template,
         allowed_tools_json=excluded.allowed_tools_json, action_schema_json=excluded.action_schema_json,
         context_mode=excluded.context_mode, source=excluded.source, skill_root=excluded.skill_root, enabled=excluded.enabled`,
      )
      .run(
        skill.name,
        skill.description,
        skill.prompt_template,
        skill.allowed_tools_json,
        skill.action_schema_json,
        skill.context_mode,
        skill.source,
        skill.skill_root,
        skill.enabled ? 1 : 0,
      )
  }

  getSkill(name: string): SkillDefinition | undefined {
    const row = this.getDb()
      .prepare('SELECT * FROM skills WHERE name = ?')
      .get(name) as Record<string, unknown> | undefined
    return row ? this.toDef(row) : undefined
  }

  listAllEnabled(): SkillDefinition[] {
    return (
      this.getDb()
        .prepare('SELECT * FROM skills WHERE enabled = 1 ORDER BY name ASC')
        .all() as Array<Record<string, unknown>>
    ).map((row) => this.toDef(row))
  }

  listBySource(source: SkillDefinition['source']): SkillDefinition[] {
    return (
      this.getDb()
        .prepare('SELECT * FROM skills WHERE source = ? ORDER BY name ASC')
        .all(source) as Array<Record<string, unknown>>
    ).map((row) => this.toDef(row))
  }

  countAll(): number {
    const row = this.getDb().prepare('SELECT COUNT(*) AS c FROM skills').get() as { c: number }
    return Number(row.c)
  }

  private toDef(row: Record<string, unknown>): SkillDefinition {
    return {
      name: String(row.name),
      description: String(row.description ?? ''),
      prompt_template: String(row.prompt_template ?? ''),
      allowed_tools_json: String(row.allowed_tools_json ?? '[]'),
      action_schema_json: String(row.action_schema_json ?? '[]'),
      context_mode: (row.context_mode === 'fork' ? 'fork' : 'inline'),
      source: ((): SkillDefinition['source'] => {
        const s = String(row.source ?? 'builtin')
        return s === 'disk' || s === 'converted' ? s : 'builtin'
      })(),
      skill_root: String(row.skill_root ?? ''),
      enabled: Number(row.enabled ?? 1) === 1,
    }
  }
}
