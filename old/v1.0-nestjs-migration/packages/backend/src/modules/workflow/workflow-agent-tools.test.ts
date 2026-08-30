import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import { MemoryAssetsService } from '../memory/index.js'
import { executeWorkflowAgentTool, resolveWorkflowToolInputs } from './workflow-agent-tools.js'
import * as dbModule from '../../db/index.js'
import { workflowPreviewService } from './preview-workflow.js'
import { workflowRuntime } from './run-workflow.js'

describe('workflow agent tools', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('prefers explicit workflow inputs over remembered inputs', () => {
    const db = createInMemoryDb()
    const memoryAssets = new MemoryAssetsService(() => db)
    memoryAssets.recordExperiencePath({
      id: 'memory.experience_path.workflow.7',
      title: 'Watch TV workflow',
      source: 'runtime',
      status: 'active',
      steps: [
        { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 7 } },
      ],
      metadata: {
        workflow_id: 7,
        workflow_inputs: { device_id: 2, app: 'bilibili' },
      },
    })

    const resolved = resolveWorkflowToolInputs(db, 7, {
      inputs: { device_id: 9, app: 'youtube' },
    })

    expect(resolved).toEqual({
      source: 'explicit',
      inputs: { device_id: 9, app: 'youtube' },
    })
  })

  it('uses remembered workflow inputs when the model omits inputs', () => {
    const db = createInMemoryDb()
    const memoryAssets = new MemoryAssetsService(() => db)
    memoryAssets.recordExperiencePath({
      id: 'memory.experience_path.workflow.7',
      title: 'Watch TV workflow',
      source: 'runtime',
      status: 'active',
      steps: [
        { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 7 } },
      ],
      metadata: {
        workflow_id: 7,
        workflow_inputs: { device_id: 2, app: 'bilibili' },
      },
    })

    const resolved = resolveWorkflowToolInputs(db, 7, {})

    expect(resolved).toEqual({
      source: 'memory',
      inputs: { device_id: 2, app: 'bilibili' },
    })
  })

  it('uses remembered workflow inputs when the stored workflow graph hash matches the live graph', () => {
    const db = createInMemoryDb()
    insertWorkflow(db, { id: 7, name: 'Published TV Flow', published: 1, graphHash: 'current_graph_hash' })
    const memoryAssets = new MemoryAssetsService(() => db)
    memoryAssets.recordExperiencePath({
      id: 'memory.experience_path.workflow.7',
      title: 'Watch TV workflow',
      source: 'runtime',
      status: 'active',
      steps: [
        { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 7 } },
      ],
      metadata: {
        workflow_id: 7,
        workflow_graph_hash: 'current_graph_hash',
        workflow_inputs: { device_id: 2, app: 'bilibili' },
      },
    })

    const resolved = resolveWorkflowToolInputs(db, 7, {})

    expect(resolved).toEqual({
      source: 'memory',
      inputs: { device_id: 2, app: 'bilibili' },
    })
  })

  it('ignores remembered workflow inputs when the stored workflow graph hash is stale', () => {
    const db = createInMemoryDb()
    insertWorkflow(db, { id: 7, name: 'Published TV Flow', published: 1, graphHash: 'current_graph_hash' })
    const memoryAssets = new MemoryAssetsService(() => db)
    memoryAssets.recordExperiencePath({
      id: 'memory.experience_path.workflow.7',
      title: 'Watch TV workflow',
      source: 'runtime',
      status: 'active',
      steps: [
        { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 7 } },
      ],
      metadata: {
        workflow_id: 7,
        workflow_graph_hash: 'previous_graph_hash',
        workflow_inputs: { device_id: 2, app: 'bilibili' },
      },
    })

    const resolved = resolveWorkflowToolInputs(db, 7, {})

    expect(resolved).toEqual({
      source: 'empty',
      inputs: {},
    })
  })

  it('uses the latest successful workflow run inputs when no memory path exists', () => {
    const db = createInMemoryDb()
    insertWorkflow(db, { id: 7, name: 'Published TV Flow', published: 1 })
    insertWorkflowRun(db, {
      workflowId: 7,
      status: 'failed',
      inputs: { device_id: 1, app: 'failed' },
      finishedAt: '2026-05-31 09:00:00',
    })
    insertWorkflowRun(db, {
      workflowId: 7,
      status: 'succeeded',
      inputs: { device_id: 2, app: 'bilibili' },
      finishedAt: '2026-05-31 08:00:00',
    })

    const resolved = resolveWorkflowToolInputs(db, 7, {})

    expect(resolved).toEqual({
      source: 'run_history',
      inputs: { device_id: 2, app: 'bilibili' },
    })
  })

  it('ignores successful run inputs that predate the current graph', () => {
    const db = createInMemoryDb()
    insertWorkflow(db, {
      id: 7,
      name: 'Changed TV Flow',
      published: 1,
      graphUpdatedAt: '2026-05-31 10:00:00',
    })
    insertWorkflowRun(db, {
      workflowId: 7,
      status: 'succeeded',
      inputs: { device_id: 2, app: 'bilibili' },
      finishedAt: '2026-05-31 08:00:00',
    })

    const resolved = resolveWorkflowToolInputs(db, 7, {})

    expect(resolved).toEqual({
      source: 'empty',
      inputs: {},
    })
  })

  it('falls back to empty inputs when no experience path exists', () => {
    const db = createInMemoryDb()

    const resolved = resolveWorkflowToolInputs(db, 404, {})

    expect(resolved).toEqual({
      source: 'empty',
      inputs: {},
    })
  })

  it('lists only published and proven workflows for Chat tools', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    insertWorkflow(db, { id: 1, name: 'Published TV Flow', published: 1 })
    insertWorkflow(db, { id: 2, name: 'Draft TV Flow', published: 0 })
    insertWorkflow(db, { id: 3, name: 'Untested TV Flow', published: 1 })
    insertWorkflowRun(db, { workflowId: 1, status: 'succeeded' })

    const result = await executeWorkflowAgentTool('list_workflows', { query: 'TV' })

    expect(result.status).toBe('success')
    expect(result.data).toMatchObject({
      workflows: [
        expect.objectContaining({
          id: 1,
          name: 'Published TV Flow',
          published: true,
          success_count: 1,
          failure_count: 0,
          last_run_status: 'succeeded',
        }),
      ],
    })
    expect((result.data as any).workflows).toHaveLength(1)
  })

  it('keeps regressed and untested workflows out of the Chat reuse pool', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    insertWorkflow(db, { id: 1, name: 'Older Proven Flow', published: 1, updatedAt: '2026-05-30 08:00:00' })
    insertWorkflow(db, { id: 2, name: 'Newer Failing Flow', published: 1, updatedAt: '2026-05-31 09:00:00' })
    insertWorkflow(db, { id: 3, name: 'Newest Untested Flow', published: 1, updatedAt: '2026-05-31 10:00:00' })
    insertWorkflowRun(db, {
      workflowId: 1,
      status: 'succeeded',
      inputs: { device_id: 2 },
      finishedAt: '2026-05-30 08:05:00',
    })
    insertWorkflowRun(db, {
      workflowId: 2,
      status: 'failed',
      inputs: { device_id: 3 },
      finishedAt: '2026-05-31 09:05:00',
    })

    const result = await executeWorkflowAgentTool('list_workflows', { query: 'Flow', limit: 3 })
    const workflows = (result.data as any).workflows

    expect(result.status).toBe('success')
    expect(workflows.map((workflow: any) => workflow.id)).toEqual([1])
    expect(workflows[0]).toMatchObject({
      evidence_status: 'proven',
      reuse_score: expect.any(Number),
    })
  })

  it('keeps workflows with only stale success evidence out of the Chat reuse pool', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    insertWorkflow(db, {
      id: 9,
      name: 'Changed TV Flow',
      published: 1,
      graphUpdatedAt: '2026-05-31 10:00:00',
    })
    insertWorkflowRun(db, {
      workflowId: 9,
      status: 'succeeded',
      inputs: { device_id: 2 },
      finishedAt: '2026-05-31 08:05:00',
    })

    const result = await executeWorkflowAgentTool('list_workflows', { query: 'Changed' })
    const workflows = (result.data as any).workflows

    expect(result.status).toBe('success')
    expect(workflows).toEqual([])
  })

  it('does not reuse a workflow when the latest success has an old graph hash', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    insertWorkflow(db, {
      id: 10,
      name: 'Same Second Changed Flow',
      published: 1,
      graphUpdatedAt: '2026-05-31 10:00:00',
      graphHash: 'current_graph_hash',
    })
    insertWorkflowRun(db, {
      workflowId: 10,
      status: 'succeeded',
      inputs: { device_id: 2 },
      finishedAt: '2026-05-31 10:00:00',
      graphHash: 'previous_graph_hash',
    })

    const result = await executeWorkflowAgentTool('list_workflows', { query: 'Same Second' })

    expect(result.status).toBe('success')
    expect((result.data as any).workflows).toEqual([])
  })

  it('blocks previewing an unpublished workflow from Chat tools', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    insertWorkflow(db, { id: 7, name: 'Draft TV Flow', published: 0 })
    const previewSpy = vi.spyOn(workflowPreviewService, 'previewWorkflow')

    const result = await executeWorkflowAgentTool('preview_workflow', {
      workflow_id: 7,
      inputs: { device_id: 2 },
    })

    expect(result).toMatchObject({
      status: 'error',
      error: 'WORKFLOW_TOOL_ERROR',
      message: 'Workflow is not published for Chat: #7',
    })
    expect(previewSpy).not.toHaveBeenCalled()
  })

  it('blocks previewing a published workflow that is not proven for Chat reuse', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    insertWorkflow(db, { id: 8, name: 'Regressed TV Flow', published: 1 })
    insertWorkflowRun(db, {
      workflowId: 8,
      status: 'succeeded',
      finishedAt: '2026-05-31 08:00:00',
    })
    insertWorkflowRun(db, {
      workflowId: 8,
      status: 'failed',
      finishedAt: '2026-05-31 09:00:00',
    })
    const previewSpy = vi.spyOn(workflowPreviewService, 'previewWorkflow')

    const result = await executeWorkflowAgentTool('preview_workflow', {
      workflow_id: 8,
      inputs: { device_id: 2 },
    })

    expect(result).toMatchObject({
      status: 'error',
      error: 'WORKFLOW_TOOL_ERROR',
      message: 'Workflow is not ready for Chat reuse: #8 (regressed)',
    })
    expect(previewSpy).not.toHaveBeenCalled()
  })

  it('returns structured blocked preview data without running the workflow', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    insertWorkflow(db, { id: 7, name: 'Published TV Flow', published: 1 })
    insertWorkflowRun(db, { workflowId: 7, status: 'succeeded' })
    const previewSpy = vi.spyOn(workflowPreviewService, 'previewWorkflow').mockReturnValue({
      workflow_id: 7,
      executable: false,
      warnings: ['缺少设备输入'],
      steps: [],
    } as any)
    const runSpy = vi.spyOn(workflowRuntime, 'runWorkflow')

    const result = await executeWorkflowAgentTool('run_workflow', {
      workflow_id: 7,
      inputs: { device_id: 2 },
    })

    expect(result.status).toBe('success')
    expect(result.data).toMatchObject({
      blocked: true,
      message: 'Workflow preview blocked: 缺少设备输入',
      input_source: 'explicit',
      preview: {
        workflow_id: 7,
        executable: false,
        warnings: ['缺少设备输入'],
        input_source: 'explicit',
      },
    })
    expect(previewSpy).toHaveBeenCalledTimes(1)
    expect(runSpy).not.toHaveBeenCalled()
  })
})

function insertWorkflow(
  db: ReturnType<typeof createInMemoryDb>,
  input: { id: number; name: string; published: 0 | 1; updatedAt?: string; graphUpdatedAt?: string; graphHash?: string },
): void {
  const updatedAt = input.updatedAt ?? '2026-05-31 08:00:00'
  db.prepare(`
    INSERT INTO workflows (id, name, description, trigger_type, published, updated_at, graph_updated_at, graph_hash)
    VALUES (?, ?, '', 'manual', ?, ?, ?, ?)
  `).run(input.id, input.name, input.published, updatedAt, input.graphUpdatedAt ?? updatedAt, input.graphHash ?? '')
}

function insertWorkflowRun(
  db: ReturnType<typeof createInMemoryDb>,
  input: {
    workflowId: number
    status: 'succeeded' | 'failed'
    inputs?: Record<string, unknown>
    finishedAt?: string
    graphHash?: string
  },
): void {
  db.prepare(`
    INSERT INTO workflow_runs (workflow_id, status, triggered_by, started_at, finished_at, result_json, inputs_json, graph_hash)
    VALUES (?, ?, 'manual', '2026-05-31 08:00:00', ?, '{}', ?, ?)
  `).run(
    input.workflowId,
    input.status,
    input.finishedAt ?? '2026-05-31 08:00:01',
    JSON.stringify(input.inputs ?? {}),
    input.graphHash ?? '',
  )
}
