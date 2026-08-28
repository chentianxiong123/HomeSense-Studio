/**
 * Port: Skill
 *
 * Skills are layered SKILL.md instruction manuals loaded on demand.
 * The skill port owns: indexing, progressive disclosure, and MCP server
 * registration. It does NOT execute tools — that's the device port.
 */

export type SkillSource = 'local' | 'remote' | 'mcp' | 'studio'

export interface SkillSummary {
  id: string
  name: string
  source: SkillSource
  enabled: boolean
  description: string
  tags: string[]
  version?: string
}

export interface SkillBody {
  summary: SkillSummary
  /** Layered SKILL.md content, ordered progressive disclosure. */
  layers: Array<{ name: string; content: string }>
  /** Optional binding to a device type. */
  device_type?: string
}

export interface SkillPort {
  list(filter?: { source?: SkillSource; device_type?: string; enabled?: boolean }): Promise<SkillSummary[]>
  load(id: string): Promise<SkillBody | undefined>
  /** Returns the names of the skills relevant to a given input — used by L3. */
  suggest_for(input: string, top_k?: number): Promise<SkillSummary[]>
}
