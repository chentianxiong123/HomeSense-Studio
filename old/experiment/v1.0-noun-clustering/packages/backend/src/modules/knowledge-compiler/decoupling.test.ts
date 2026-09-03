import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import { KnowledgeCompilerService } from './index.js'
import { SqlKnowledgeCompilerRepository } from './repository.js'

interface UpsertCall {
  kind: string
  title: string
  source_type: string
  source_ref: string
  rank_score?: number
}

class FakeMemoryKernel {
  readonly upserts: UpsertCall[] = []
  upsertCompiledKnowledge(params: UpsertCall): void {
    this.upserts.push(params)
  }
}

class FakePlanLibrary {
  constructor(private readonly plans: Array<{ id: string; name: string; intent?: string; input?: string; steps: Array<{ tool: string; action: string; params: Record<string, unknown> }> }> = []) {}
  listPlans() {
    return this.plans
  }
}

class FakeFileReader {
  constructor(private readonly files: Map<string, string> = new Map()) {}
  readFile(filePath: string): string {
    return this.files.get(filePath) ?? ''
  }
}

describe('knowledge-compiler · refreshKnowledge upserts compiled items', () => {
  it('compiles entities, experiences, plans, workflows in one pass', () => {
    const db = createInMemoryDb()

    // seed minimal data
    db.prepare(
      `INSERT INTO memory_entities (id, name, type, wing, room, properties_json) VALUES (?, ?, ?, ?, ?, ?)`,
    ).run('device.lamp', 'Lamp', 'device', 'home', 'living', '{}')
    db.prepare(
      `INSERT INTO memory_attributes (entity_id, key, value) VALUES (?, ?, ?)`,
    ).run('device.lamp', 'supports_power', 'true')
    db.prepare(
      `INSERT INTO experiences (category, title, file_path, content_hash, importance)
       VALUES ('device-control', 'turn on lamp', '/fake/exp/lamp.md', 'h1', 0.85)`,
    ).run()
    db.prepare(
      `INSERT INTO workflows (name, description, graph_json, trigger_type, published)
       VALUES ('demo', 'a demo wf', '{"nodes":[{"label":"start"}]}', 'manual', 1)`,
    ).run()

    const repo = new SqlKnowledgeCompilerRepository(() => db)
    const memoryKernel = new FakeMemoryKernel()
    const planLib = new FakePlanLibrary([
      { id: 'plan_1', name: 'Watch Bilibili', intent: 'watch', input: 'tv', steps: [{ tool: 'mi-cli', action: 'scene_execute', params: {} }] },
    ])
    const files = new FakeFileReader(new Map([
      ['/fake/exp/lamp.md', '---\ntitle: turn on lamp\n---\n## Steps\n1. set_prop'],
    ]))

    const compiler = new KnowledgeCompilerService(repo, memoryKernel, planLib, files)
    const result = compiler.refreshKnowledge()

    expect(result.entity_pages).toBe(1)
    expect(result.experience_notes).toBe(1)
    expect(result.compiled_plans).toBe(2) // 1 from experience >=0.7 + 1 from plan-library
    expect(result.workflow_candidates).toBe(1)

    const kinds = memoryKernel.upserts.map((u) => u.kind)
    expect(kinds).toContain('wiki_page')
    expect(kinds).toContain('experience_note')
    expect(kinds).toContain('compiled_plan')
    expect(kinds).toContain('workflow_candidate')

    const planUpserts = memoryKernel.upserts.filter((u) => u.kind === 'compiled_plan')
    expect(planUpserts.some((u) => u.source_type === 'experience_plan')).toBe(true)
    expect(planUpserts.some((u) => u.source_type === 'legacy_success_path')).toBe(true)
  })

  it('experiences below importance 0.7 do NOT generate compiled_plan', () => {
    const db = createInMemoryDb()
    db.prepare(
      `INSERT INTO experiences (category, title, file_path, content_hash, importance)
       VALUES ('cat', 'low-importance', '/fake/low.md', 'hh', 0.4)`,
    ).run()

    const repo = new SqlKnowledgeCompilerRepository(() => db)
    const memoryKernel = new FakeMemoryKernel()
    const files = new FakeFileReader(new Map([['/fake/low.md', '## Step\n1. do x']]))
    const compiler = new KnowledgeCompilerService(repo, memoryKernel, new FakePlanLibrary(), files)

    compiler.refreshKnowledge()

    const planUpserts = memoryKernel.upserts.filter((u) => u.kind === 'compiled_plan' && u.source_type === 'experience_plan')
    expect(planUpserts.length).toBe(0)
  })

  it('runs end-to-end with no fs and no real memory-kernel', () => {
    const db = createInMemoryDb()
    const repo = new SqlKnowledgeCompilerRepository(() => db)
    const memoryKernel = new FakeMemoryKernel()
    const compiler = new KnowledgeCompilerService(
      repo,
      memoryKernel,
      new FakePlanLibrary(),
      new FakeFileReader(),
    )

    const result = compiler.refreshKnowledge()
    expect(result.entity_pages).toBe(0)
    expect(memoryKernel.upserts.length).toBe(0)
  })
})
