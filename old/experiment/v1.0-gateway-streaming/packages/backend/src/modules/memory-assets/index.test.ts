import { describe, expect, it } from 'vitest'
import { MemoryAssetsService } from './index.js'
import { createInMemoryDb } from '../../db/index.js'

describe('MemoryAssetsService', () => {
  it('exposes legacy executable paths as memory experience paths', () => {
    const db = createInMemoryDb()
    const service = new MemoryAssetsService(() => db)
    const assets = service.list()
    const summary = service.summary()

    expect(summary.by_kind.experience_path).toBeGreaterThanOrEqual(1)
    expect(assets.some((asset) => asset.kind === 'experience_path' && asset.source !== 'placeholder')).toBe(true)
    expect(assets.some((asset) => asset.kind === 'user_feedback' && asset.status === 'planned')).toBe(true)
    expect(assets.find((asset) => asset.kind === 'experience_path')).toMatchObject({
      skill_refs: expect.any(Array),
      device_refs: expect.any(Array),
    })
    expect(
      (db.prepare("SELECT COUNT(*) AS c FROM memory_items WHERE kind = 'experience_path'").get() as { c: number }).c,
    ).toBeGreaterThanOrEqual(1)
    const pathRow = db.prepare('SELECT skill_refs_json, device_refs_json FROM memory_experience_paths LIMIT 1').get() as
      | { skill_refs_json: string; device_refs_json: string }
      | undefined
    expect(pathRow?.skill_refs_json).toBeDefined()
    expect(pathRow?.device_refs_json).toBeDefined()
  })

  it('records runtime experience paths with skill and device references', () => {
    const db = createInMemoryDb()
    const service = new MemoryAssetsService(() => db)

    const asset = service.recordExperiencePath({
      id: 'memory.experience_path.runtime.test.watch-tv',
      title: '客厅电视打开 B 站',
      summary: '在客厅电视上打开 Bilibili 的成功链路。',
      intent_pattern: '看电视的 B 站',
      source: 'runtime',
      origin_trace_id: 'trace.test.1',
      conversation_id: 1,
      steps: [
        { tool: 'adb-cli', action: 'launch_app', params: { package: 'tv.danmaku.bili' } },
      ],
      skill_refs: [
        { kind: 'device_skill', id: 'device_skill.tv_box', label: '机顶盒' },
        { kind: 'general_skill', id: 'adb-cli', label: 'ADB CLI' },
      ],
      device_refs: ['device:living-tv'],
    })

    expect(asset).toMatchObject({
      kind: 'experience_path',
      source: 'runtime',
      status: 'active',
      skill_refs: [
        { kind: 'device_skill', id: 'device_skill.tv_box', label: '机顶盒' },
        { kind: 'general_skill', id: 'adb-cli', label: 'ADB CLI' },
      ],
      device_refs: ['device:living-tv'],
    })

    service.recordExperiencePath({
      id: 'memory.experience_path.runtime.test.watch-tv',
      title: '客厅电视打开 B 站',
      steps: [
        { tool: 'adb-cli', action: 'launch_app', params: { package: 'tv.danmaku.bili' } },
      ],
    })

    const row = db.prepare(`
      SELECT success_count, origin_trace_id, skill_refs_json, device_refs_json
      FROM memory_experience_paths
      WHERE memory_item_id = ?
    `).get('memory.experience_path.runtime.test.watch-tv') as {
      success_count: number
      origin_trace_id: string
      skill_refs_json: string
      device_refs_json: string
    }

    expect(row.success_count).toBe(2)
    expect(row.origin_trace_id).toBe('trace.test.1')
    expect(JSON.parse(row.skill_refs_json)).toEqual([
      { kind: 'device_skill', id: 'device_skill.tv_box', label: '机顶盒' },
      { kind: 'general_skill', id: 'adb-cli', label: 'ADB CLI' },
    ])
    expect(JSON.parse(row.device_refs_json)).toEqual(['device:living-tv'])

    const listed = service.list().find((item) => item.id === 'memory.experience_path.runtime.test.watch-tv')
    expect(listed?.metadata).toMatchObject({
      success_count: 2,
      failure_count: 0,
      run_status: 'succeeded',
      evidence_status: 'proven',
      reuse_score: expect.any(Number),
    })
  })

  it('searches saved experience paths for L2 recall', () => {
    const db = createInMemoryDb()
    const service = new MemoryAssetsService(() => db)

    service.recordExperiencePath({
      id: 'memory.experience_path.runtime.test.bilibili',
      title: '客厅电视打开 B 站',
      summary: '在客厅电视上打开 Bilibili 的成功链路。',
      intent_pattern: '我要看 B 站',
      source: 'runtime',
      steps: [
        { tool: 'device_agent', action: 'execute_device_capability', params: { device_id: 2, capability_id: 'adb.launch_app' } },
      ],
      skill_refs: [{ kind: 'device_skill', id: 'device_skill.tv_box', label: '机顶盒' }],
      device_refs: ['2'],
    })

    const hits = service.searchExperiencePaths('看 B 站', 3)

    expect(hits[0]).toMatchObject({
      id: 'memory:memory.experience_path.runtime.test.bilibili',
      type: 'experience_path',
      source: 'memory',
    })
    expect(hits[0].metadata).toMatchObject({
      memory_item_id: 'memory.experience_path.runtime.test.bilibili',
      device_refs: ['device:2'],
      success_count: 1,
      failure_count: 0,
      evidence_status: 'proven',
      reuse_score: expect.any(Number),
    })
  })

  it('skips workflow experience paths whose stored graph hash no longer matches the live workflow', () => {
    const db = createInMemoryDb()
    const service = new MemoryAssetsService(() => db)
    db.prepare(`
      INSERT INTO workflows (id, name, description, trigger_type, published, graph_hash)
      VALUES (7, 'Current TV Flow', '', 'manual', 1, 'current_graph_hash')
    `).run()
    db.prepare(`
      INSERT INTO workflows (id, name, description, trigger_type, published, graph_hash)
      VALUES (8, 'Stale TV Flow', '', 'manual', 1, 'current_graph_hash')
    `).run()

    service.recordExperiencePath({
      id: 'memory.experience_path.workflow.7',
      title: '看电视当前路径',
      summary: '成功运行过的看电视路径',
      intent_pattern: '看电视',
      source: 'runtime',
      steps: [
        { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 7, inputs: { device_id: 3 } } },
      ],
      metadata: {
        workflow_id: 7,
        workflow_graph_hash: 'current_graph_hash',
        workflow_inputs: { device_id: 3 },
      },
    })
    service.recordExperiencePath({
      id: 'memory.experience_path.workflow.8',
      title: '看电视旧路径',
      summary: '旧图版本运行过的看电视路径',
      intent_pattern: '看电视',
      source: 'runtime',
      steps: [
        { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 8, inputs: { device_id: 4 } } },
      ],
      metadata: {
        workflow_id: 8,
        workflow_graph_hash: 'previous_graph_hash',
        workflow_inputs: { device_id: 4 },
      },
    })

    const hits = service.searchExperiencePaths('看电视', 5)
    const ids = hits.map((hit) => hit.id)

    expect(ids).toContain('memory:memory.experience_path.workflow.7')
    expect(ids).not.toContain('memory:memory.experience_path.workflow.8')
    expect(hits.find((hit) => hit.id === 'memory:memory.experience_path.workflow.7')?.metadata).toMatchObject({
      workflow_graph_hash: 'current_graph_hash',
      current_workflow_graph_hash: 'current_graph_hash',
    })
  })

  it('loads one memory asset with path details for the Assets detail page', () => {
    const db = createInMemoryDb()
    const service = new MemoryAssetsService(() => db)

    service.recordExperiencePath({
      id: 'memory.experience_path.workflow.7.run.22',
      title: '看电视 Workflow #22',
      summary: '成功运行过的看电视路径',
      intent_pattern: '看电视',
      source: 'user',
      steps: [
        { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 7, inputs: { device_id: 3 } } },
      ],
      metadata: {
        workflow_id: 7,
        workflow_inputs: { device_id: 3, capability_id: 'mi.ir_key' },
      },
    })

    const asset = service.get('memory.experience_path.workflow.7.run.22')

    expect(asset).toMatchObject({
      id: 'memory.experience_path.workflow.7.run.22',
      kind: 'experience_path',
      metadata: {
        workflow_id: 7,
        workflow_inputs: { device_id: 3, capability_id: 'mi.ir_key' },
        intent_pattern: '看电视',
        steps: [
          { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 7, inputs: { device_id: 3 } } },
        ],
        success_count: 0,
        failure_count: 0,
      },
    })
  })

  it('records failed runtime paths without incrementing success count', () => {
    const db = createInMemoryDb()
    const service = new MemoryAssetsService(() => db)

    service.recordExperiencePathFailure({
      id: 'memory.experience_path.workflow.7',
      title: '客厅电视 Workflow',
      summary: '失败的工作流路径',
      intent_pattern: '打开客厅电视',
      source: 'runtime',
      status: 'draft',
      origin_trace_id: 'workflow.7.run.1',
      error: 'device offline',
      steps: [
        { tool: 'device_agent', action: 'execute_device_capability', params: { device_id: 7, capability_id: 'mi.ir_key' } },
      ],
      device_refs: ['7'],
    })

    service.recordExperiencePath({
      id: 'memory.experience_path.workflow.7',
      title: '客厅电视 Workflow',
      summary: '成功的工作流路径',
      intent_pattern: '打开客厅电视',
      source: 'runtime',
      status: 'active',
      origin_trace_id: 'workflow.7.run.2',
      steps: [
        { tool: 'device_agent', action: 'execute_device_capability', params: { device_id: 7, capability_id: 'mi.ir_key' } },
      ],
      device_refs: ['7'],
    })

    const row = db.prepare(`
      SELECT success_count, failure_count, origin_trace_id, device_refs_json
      FROM memory_experience_paths
      WHERE memory_item_id = ?
    `).get('memory.experience_path.workflow.7') as {
      success_count: number
      failure_count: number
      origin_trace_id: string
      device_refs_json: string
    }

    expect(row.success_count).toBe(1)
    expect(row.failure_count).toBe(1)
    expect(row.origin_trace_id).toBe('workflow.7.run.2')
    expect(JSON.parse(row.device_refs_json)).toEqual(['device:7'])

    expect(service.get('memory.experience_path.workflow.7')?.metadata).toMatchObject({
      run_status: 'succeeded',
      evidence_status: 'proven',
      reuse_score: expect.any(Number),
    })
  })
})
