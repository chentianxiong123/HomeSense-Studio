import { describe, expect, it, vi } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import { FakeEventBus } from '../../test-support/index.js'
import { WorkflowPreviewService } from './preview-workflow.js'
import { workflowNodeFactory } from './node-factory.js'
import { WorkflowRuntime } from './run-workflow.js'

describe('workflow runtime', () => {
  it('previews and runs a branched workflow with trace and live node metadata', async () => {
    const db = createInMemoryDb()
    const ids = insertBranchedWorkflow(db)

    const preview = new WorkflowPreviewService(() => db).previewWorkflow(ids.workflowId, { intent: 'watch_tv' })

    expect(preview.executable).toBe(true)
    expect(preview.steps.map((step) => [step.node_type, step.preview_state])).toEqual([
      ['start', 'ready'],
      ['if_else', 'ready'],
      ['answer', 'ready'],
    ])
    expect(preview.steps.find((step) => step.node_id === String(ids.conditionId))?.active_outputs).toEqual(['true'])

    const bus = new FakeEventBus()
    const runtime = new WorkflowRuntime(
      () => db,
      bus,
      { observeOutcome: () => {} },
      { processFailureAndEnhance: () => {} },
    )

    const result = await runtime.runWorkflow(ids.workflowId, { intent: 'watch_tv' })

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toEqual({ answer: 'route=watch_tv matched=true' })
    expect(result.trace.map((step) => [step.node_type, step.status])).toEqual([
      ['start', 'succeeded'],
      ['if_else', 'succeeded'],
      ['answer', 'succeeded'],
    ])
    expect(result.trace[2].resolved_inputs).toEqual({ message: 'route=watch_tv matched=true' })

    const completedEvent = bus.fired.find(
      (event) =>
        event.event === 'workflow_node_completed' &&
        (event.data as { node_id?: string }).node_id === String(ids.answerId),
    )
    expect(completedEvent?.data).toMatchObject({
      workflow_id: ids.workflowId,
      node_id: String(ids.answerId),
      node_type: 'answer',
      label: 'Reply',
      outputs: { answer: 'route=watch_tv matched=true' },
    })
    expect(typeof (completedEvent?.data as { duration_ms?: unknown }).duration_ms).toBe('number')

    const runRow = db.prepare('SELECT status, result_json, inputs_json, graph_hash, trace_json, events_json FROM workflow_runs WHERE id = ?').get(result.run_id) as {
      status: string
      result_json: string
      inputs_json: string
      graph_hash: string
      trace_json: string
      events_json: string
    }
    const workflowRow = db.prepare('SELECT graph_hash FROM workflows WHERE id = ?').get(ids.workflowId) as { graph_hash: string }
    expect(runRow.status).toBe('succeeded')
    expect(runRow.graph_hash).toBeTruthy()
    expect(runRow.graph_hash).toBe(workflowRow.graph_hash)
    expect(result.graph_hash).toBe(workflowRow.graph_hash)
    expect(JSON.parse(runRow.result_json)).toEqual({ answer: 'route=watch_tv matched=true' })
    expect(JSON.parse(runRow.inputs_json)).toEqual({ intent: 'watch_tv' })
    expect(JSON.parse(runRow.trace_json).map((step: { node_type: string; status: string }) => [step.node_type, step.status])).toEqual([
      ['start', 'succeeded'],
      ['if_else', 'succeeded'],
      ['answer', 'succeeded'],
    ])
    expect(JSON.parse(runRow.events_json).map((event: { type: string; node_type: string }) => [event.type, event.node_type])).toEqual([
      ['node_started', 'start'],
      ['node_completed', 'start'],
      ['node_started', 'if_else'],
      ['node_completed', 'if_else'],
      ['node_started', 'answer'],
      ['node_completed', 'answer'],
    ])
  })

  it('skips inactive branches without failing the workflow', async () => {
    const db = createInMemoryDb()
    const ids = insertBranchedWorkflow(db)

    const preview = new WorkflowPreviewService(() => db).previewWorkflow(ids.workflowId, { intent: 'music' })
    expect(preview.executable).toBe(true)
    expect(preview.steps.map((step) => [step.node_type, step.preview_state])).toEqual([
      ['start', 'ready'],
      ['if_else', 'ready'],
      ['answer', 'skipped'],
    ])

    const runtime = new WorkflowRuntime(
      () => db,
      new FakeEventBus(),
      { observeOutcome: () => {} },
      { processFailureAndEnhance: () => {} },
    )

    const result = await runtime.runWorkflow(ids.workflowId, { intent: 'music' })

    expect(result.status).toBe('succeeded')
    expect(result.outputs).toEqual({})
    expect(result.trace.map((step) => [step.node_type, step.status])).toEqual([
      ['start', 'succeeded'],
      ['if_else', 'succeeded'],
      ['answer', 'skipped'],
    ])
  })

  it('exposes subflow preview metadata for Studio cards', () => {
    const db = createInMemoryDb()
    const ids = insertSubflowWorkflow(db)

    const preview = new WorkflowPreviewService(() => db).previewWorkflow(ids.parentWorkflowId, { message: 'hello child' })
    const subflowStep = preview.steps.find((step) => step.node_id === String(ids.subflowId))

    expect(preview.executable).toBe(true)
    expect(subflowStep).toMatchObject({
      executor_name: 'workflow.subflow',
      target: `${ids.childWorkflowId}:Child Runtime Test`,
      action: 'run_workflow',
      subflow: {
        workflow_id: ids.childWorkflowId,
        workflow_name: 'Child Runtime Test',
        input_keys: ['message'],
        output_key: 'answer',
        node_count: 2,
      },
    })
  })

  it('runs subflow nodes through the current workflow runtime dependencies', async () => {
    const db = createInMemoryDb()
    const ids = insertSubflowWorkflow(db)
    const originalDeps = workflowNodeFactory.getDeps()
    let runtime: WorkflowRuntime

    workflowNodeFactory.setDeps({
      ...originalDeps,
      workflowRuntime: {
        runWorkflow: async (workflowId, inputs, options) => runtime.runWorkflow(workflowId, inputs, options),
        runWorkflowByName: async (workflowName, inputs, options) => runtime.runWorkflowByName(workflowName, inputs, options),
      },
    })

    try {
      runtime = new WorkflowRuntime(
        () => db,
        new FakeEventBus(),
        { observeOutcome: () => {} },
        { processFailureAndEnhance: () => {} },
        { recordExperiencePath: () => {}, recordExperiencePathFailure: () => {} },
      )

      const result = await runtime.runWorkflow(ids.parentWorkflowId, { message: 'hello child' })

      expect(result.status).toBe('succeeded')
      expect(result.outputs).toEqual({ answer: 'parent saw: hello child' })
      expect(result.trace.map((step) => [step.node_type, step.status])).toEqual([
        ['start', 'succeeded'],
        ['subflow', 'succeeded'],
        ['answer', 'succeeded'],
      ])
      expect(result.trace[1].outputs).toMatchObject({
        value: 'hello child',
        trigger: true,
        subflow: {
          workflow_id: ids.childWorkflowId,
          status: 'succeeded',
          outputs: { answer: 'hello child' },
          trace_count: 2,
          trace: [
            { node_type: 'start', status: 'succeeded' },
            { node_type: 'answer', status: 'succeeded', outputs: { answer: 'hello child' } },
          ],
        },
      })

      const childRuns = db.prepare('SELECT status, result_json FROM workflow_runs WHERE workflow_id = ?').all(ids.childWorkflowId) as Array<{
        status: string
        result_json: string
      }>
      expect(childRuns).toHaveLength(1)
      expect(childRuns[0].status).toBe('succeeded')
      expect(JSON.parse(childRuns[0].result_json)).toEqual({ answer: 'hello child' })
    } finally {
      workflowNodeFactory.setDeps(originalDeps)
    }
  })

  it('blocks subflow preview when the child workflow is missing or self-referential', () => {
    const db = createInMemoryDb()
    const ids = insertSubflowWorkflow(db)
    const previewService = new WorkflowPreviewService(() => db)

    db.prepare('UPDATE workflow_nodes SET config_json = ? WHERE id = ?').run(
      JSON.stringify({
        workflow_id: 999999,
        inputs: { message: '{{input.message}}' },
        output_key: 'answer',
      }),
      ids.subflowId,
    )
    const missingChild = previewService.previewWorkflow(ids.parentWorkflowId, { message: 'hello child' })
    const missingStep = missingChild.steps.find((step) => step.node_id === String(ids.subflowId))

    expect(missingChild.executable).toBe(false)
    expect(missingStep).toMatchObject({
      preview_state: 'blocked',
      runnable: false,
      summary: 'Child workflow #999999 was not found.',
    })
    expect(missingChild.warnings).toContain('Run Child: Child workflow #999999 was not found.')

    db.prepare('UPDATE workflow_nodes SET config_json = ? WHERE id = ?').run(
      JSON.stringify({
        workflow_id: ids.parentWorkflowId,
        inputs: { message: '{{input.message}}' },
        output_key: 'answer',
      }),
      ids.subflowId,
    )
    const selfReferential = previewService.previewWorkflow(ids.parentWorkflowId, { message: 'hello child' })
    const selfStep = selfReferential.steps.find((step) => step.node_id === String(ids.subflowId))

    expect(selfReferential.executable).toBe(false)
    expect(selfStep).toMatchObject({
      preview_state: 'blocked',
      runnable: false,
      summary: `Subflow cannot call the current workflow (#${ids.parentWorkflowId}).`,
    })
  })

  it('halts recursive subflows after the runtime depth limit', async () => {
    const db = createInMemoryDb()
    const ids = insertRecursiveSubflowWorkflow(db)
    const originalDeps = workflowNodeFactory.getDeps()
    let runtime: WorkflowRuntime

    workflowNodeFactory.setDeps({
      ...originalDeps,
      workflowRuntime: {
        runWorkflow: async (workflowId, inputs, options) => runtime.runWorkflow(workflowId, inputs, options),
        runWorkflowByName: async (workflowName, inputs, options) => runtime.runWorkflowByName(workflowName, inputs, options),
      },
    })

    try {
      runtime = new WorkflowRuntime(
        () => db,
        new FakeEventBus(),
        { observeOutcome: () => {} },
        { processFailureAndEnhance: () => {} },
        { recordExperiencePath: () => {}, recordExperiencePathFailure: () => {} },
      )

      const result = await runtime.runWorkflow(ids.workflowId, { message: 'loop' })

      expect(result.status).toBe('failed')
      expect(result.trace.some((step) => step.node_type === 'subflow')).toBe(true)
      expect(result.trace.find((step) => step.node_type === 'subflow')?.error).toContain('Subflow call depth exceeded 6')
    } finally {
      workflowNodeFactory.setDeps(originalDeps)
    }
  })

  it('runs device capability nodes through the shared device-agent rehearsal path', async () => {
    const db = createInMemoryDb()
    const ids = insertDeviceCapabilityWorkflow(db)
    const originalDeps = workflowNodeFactory.getDeps()

    workflowNodeFactory.setDeps({
      ...originalDeps,
      deviceAgentTools: {
        execute: async (name: string, params: Record<string, unknown>) => {
          if (name === 'rehearse_device_capability') {
            return {
              status: 'success',
              executor: name,
              data: {
                ok: true,
                executable: true,
                device: {
                  id: 7,
                  name: '客厅机顶盒',
                },
                capability_id: 'mi.ir_key',
                capability: '遥控按键',
                arguments: params.arguments ?? {},
              },
            }
          }

          if (name === 'execute_device_capability') {
            return {
              status: 'success',
              executor: name,
              data: {
                status: 'success',
                device_id: 7,
                capability_id: 'mi.ir_key',
                capability: '遥控按键',
                arguments: params.arguments ?? {},
              },
            }
          }

          return {
            status: 'error',
            executor: name,
            error: `unexpected tool ${name}`,
          }
        },
      },
    })

    try {
      const preview = new WorkflowPreviewService(() => db).previewWorkflow(ids.workflowId, {
        device_id: 7,
        capability_id: 'mi.ir_key',
        key: 'BACK',
      })
      expect(preview.steps.map((step) => [step.node_type, step.preview_state])).toEqual([
        ['start', 'ready'],
        ['device_capability', 'ready'],
        ['answer', 'ready'],
      ])

      const observeOutcome = vi.fn()
      const recordExperiencePath = vi.fn()
      const runtime = new WorkflowRuntime(
        () => db,
        new FakeEventBus(),
        { observeOutcome },
        { processFailureAndEnhance: () => {} },
        { recordExperiencePath, recordExperiencePathFailure: () => {} },
      )

      const result = await runtime.runWorkflow(ids.workflowId, {
        device_id: 7,
        capability_id: 'mi.ir_key',
        key: 'BACK',
      })

      expect(result.status).toBe('succeeded')
      expect(result.outputs).toEqual({ answer: 'capability=success' })
      expect(result.trace.map((step) => [step.node_type, step.status])).toEqual([
        ['start', 'succeeded'],
        ['device_capability', 'succeeded'],
        ['answer', 'succeeded'],
      ])
      expect(result.trace[1].outputs).toMatchObject({
        trigger: true,
      })
      expect(observeOutcome).toHaveBeenCalledWith({
        intent: 'workflow.device_capability.Run Capability.mi.ir_key',
        target_device_id: '7',
        tool: 'device_agent',
        action: 'execute_device_capability',
        success: true,
        error: undefined,
      })
      expect(recordExperiencePath).toHaveBeenCalledWith(expect.objectContaining({
        id: `memory.experience_path.workflow.${ids.workflowId}`,
        title: 'Device Capability Runtime Test',
        source: 'runtime',
        status: 'active',
        origin_trace_id: `workflow.${ids.workflowId}.run.${result.run_id}`,
        steps: [
          {
            tool: 'device_agent',
            action: 'execute_device_capability',
            params: {
              device_id: 7,
              capability_id: 'mi.ir_key',
              capability: undefined,
              arguments: { key: 'BACK' },
            },
          },
        ],
        skill_refs: [
          { kind: 'general_skill', id: 'mi-cli', label: 'Mi CLI' },
        ],
        device_refs: ['device:7'],
        metadata: expect.objectContaining({
          workflow_graph_hash: result.graph_hash,
          workflow_inputs: {
            device_id: 7,
            capability_id: 'mi.ir_key',
            key: 'BACK',
          },
        }),
      }))
    } finally {
      workflowNodeFactory.setDeps(originalDeps)
    }
  })

  it('marks executor_call failed when the nested CLI invocation reports an error', async () => {
    const db = createInMemoryDb()
    const ids = insertExecutorCallWorkflow(db)
    const originalDeps = workflowNodeFactory.getDeps()
    const observeOutcome = vi.fn()
    const processFailureAndEnhance = vi.fn()

    workflowNodeFactory.setDeps({
      ...originalDeps,
      executorGateway: {
        invoke: async () => ({
          status: 'success',
          executor: 'cli.invoke',
          data: {
            status: 'error',
            error: 'CAST_SERVICE_UNAVAILABLE',
            message: 'bilibili-music service is not reachable at http://127.0.0.1:9: fetch failed',
          },
        }),
      },
    })

    try {
      const runtime = new WorkflowRuntime(
        () => db,
        new FakeEventBus(),
        { observeOutcome },
        { processFailureAndEnhance },
        { recordExperiencePath: () => {}, recordExperiencePathFailure: () => {} },
      )

      const result = await runtime.runWorkflow(ids.workflowId, {
        base_url: 'http://127.0.0.1:9',
      })

      expect(result.status).toBe('failed')
      expect(result.error).toContain('bilibili-music service is not reachable')
      expect(result.trace.map((step) => [step.node_type, step.status])).toEqual([
        ['start', 'succeeded'],
        ['executor_call', 'failed'],
        ['answer', 'skipped'],
      ])
      expect(result.trace[1].outputs).toMatchObject({
        result: {
          status: 'error',
          error: 'CAST_SERVICE_UNAVAILABLE',
        },
      })
      expect(observeOutcome).toHaveBeenCalledWith(expect.objectContaining({
        tool: 'dlna-cast-cli',
        action: 'discover_devices',
        success: false,
        error: expect.stringContaining('bilibili-music service is not reachable'),
      }))
      expect(processFailureAndEnhance).toHaveBeenCalledWith(expect.objectContaining({
        task_type: 'workflow_executor_call',
        expected: 'executor call succeeds',
        actual: expect.stringContaining('bilibili-music service is not reachable'),
      }))
    } finally {
      workflowNodeFactory.setDeps(originalDeps)
    }
  })

  it.skip('records failed nodes as compensation observations (compensation module removed)', async () => {
    const db = createInMemoryDb()
    const ids = insertFailingCodeWorkflow(db)
    const bus = new FakeEventBus()
    const recordWorkflowNodeFailure = vi.fn(() => ({ id: 123 }))
    const runtime = new WorkflowRuntime(
      () => db,
      bus,
      { observeOutcome: () => {} },
      { processFailureAndEnhance: () => {} },
    )

    const result = await runtime.runWorkflow(ids.workflowId, { intent: 'fail_demo' }, { triggeredBy: 'chat' })

    expect(result.status).toBe('failed')
    expect(result.trace.map((step) => [step.node_type, step.status])).toEqual([
      ['start', 'succeeded'],
      ['code', 'failed'],
      ['answer', 'skipped'],
    ])
    expect(result.trace[1].compensation_task_id).toBe(123)
    expect(recordWorkflowNodeFailure).toHaveBeenCalledWith(expect.objectContaining({
      workflow_id: ids.workflowId,
      run_id: result.run_id,
      node_id: String(ids.codeId),
      node_type: 'code',
      label: 'Explode',
      error: 'boom',
      triggered_by: 'chat',
    }))

    const failedNodeEvent = bus.fired.find(
      (event) =>
        event.event === 'workflow_node_failed' &&
        (event.data as { node_id?: string }).node_id === String(ids.codeId),
    )
    expect(failedNodeEvent?.data).toMatchObject({
      workflow_id: ids.workflowId,
      node_id: String(ids.codeId),
      compensation_task_id: 123,
    })

    const workflowFailed = bus.lastOf('workflow_failed')
    expect(workflowFailed?.data).toMatchObject({
      workflow_id: ids.workflowId,
      run_id: result.run_id,
      failed_node_ids: [String(ids.codeId)],
      compensation_task_ids: [123],
    })

    const runRow = db.prepare('SELECT status, trace_json, events_json FROM workflow_runs WHERE id = ?').get(result.run_id) as {
      status: string
      trace_json: string
      events_json: string
    }
    expect(runRow.status).toBe('failed')
    expect(JSON.parse(runRow.trace_json).map((step: { node_type: string; status: string }) => [step.node_type, step.status])).toEqual([
      ['start', 'succeeded'],
      ['code', 'failed'],
      ['answer', 'skipped'],
    ])
    expect(JSON.parse(runRow.events_json).map((event: { type: string; node_type: string }) => [event.type, event.node_type])).toEqual([
      ['node_started', 'start'],
      ['node_completed', 'start'],
      ['node_started', 'code'],
      ['node_failed', 'code'],
      ['node_skipped', 'answer'],
    ])
  })

  it('retries a failed node when retry policy is configured', async () => {
    const db = createInMemoryDb()
    const ids = insertRetryCodeWorkflow(db)
    const runtime = new WorkflowRuntime(
      () => db,
      new FakeEventBus(),
      { observeOutcome: () => {} },
      { processFailureAndEnhance: () => {} },
    )

    delete (globalThis as Record<string, unknown>).__workflowRetryCount
    try {
      const result = await runtime.runWorkflow(ids.workflowId)

      expect(result.status).toBe('succeeded')
      expect(result.outputs).toEqual({ answer: 'retry=true' })
      expect(result.trace.map((step) => [step.node_type, step.status])).toEqual([
        ['start', 'succeeded'],
        ['code', 'succeeded'],
        ['answer', 'succeeded'],
      ])
      expect(result.trace[1]).toMatchObject({
        attempts: 2,
        retry_errors: ['temporary'],
      })
    } finally {
      delete (globalThis as Record<string, unknown>).__workflowRetryCount
    }
  })

  it('blocks device capability preview when device binding or required arguments are missing', () => {
    const db = createInMemoryDb()
    const ids = insertDeviceCapabilityWorkflow(db)
    const previewService = new WorkflowPreviewService(() => db)

    const defaultInputPreview = previewService.previewWorkflow(ids.workflowId)
    const defaultInputStep = defaultInputPreview.steps.find((step) => step.node_type === 'device_capability')
    expect(defaultInputPreview.executable).toBe(true)
    expect(defaultInputStep).toMatchObject({
      preview_state: 'ready',
      runnable: true,
      resolution_mode: 'simulated',
    })

    db.prepare('UPDATE user_devices SET mi_did = NULL WHERE id = ?').run(7)
    const noBinding = previewService.previewWorkflow(ids.workflowId, {
      device_id: 7,
      capability_id: 'mi.ir_key',
      key: 'BACK',
    })
    const noBindingStep = noBinding.steps.find((step) => step.node_type === 'device_capability')

    expect(noBinding.executable).toBe(false)
    expect(noBindingStep).toMatchObject({
      preview_state: 'blocked',
      runnable: false,
      summary: '客厅机顶盒 has no MI binding.',
    })
    expect(noBinding.warnings).toContain('Run Capability: 客厅机顶盒 has no MI binding.')

    db.prepare('UPDATE user_devices SET mi_did = ? WHERE id = ?').run('mi.demo.ir', 7)
    const missingArgs = previewService.previewWorkflow(ids.workflowId, {
      device_id: 7,
      capability_id: 'mi.ir_key',
      key: '',
    })
    const missingArgsStep = missingArgs.steps.find((step) => step.node_type === 'device_capability')

    expect(missingArgs.executable).toBe(false)
    expect(missingArgsStep).toMatchObject({
      preview_state: 'blocked',
      runnable: false,
      summary: 'mi.ir_key is missing argument(s): key_id.',
    })
    expect(missingArgs.warnings).toContain('Run Capability: mi.ir_key is missing argument(s): key_id.')

    const capabilityNodeId = ids.deviceCapabilityId
    db.prepare('UPDATE workflow_nodes SET config_json = ? WHERE id = ?').run(
      JSON.stringify({
        device_id: '{{input.device_id}}',
        capability_id: '{{input.capability_id}}',
        arguments: { value: '{{input.value}}' },
      }),
      capabilityNodeId,
    )
    const missingValue = previewService.previewWorkflow(ids.workflowId, {
      device_id: 7,
      capability_id: 'mi.target_temperature',
      value: '',
    })
    const missingValueStep = missingValue.steps.find((step) => step.node_type === 'device_capability')

    expect(missingValue.executable).toBe(false)
    expect(missingValueStep).toMatchObject({
      preview_state: 'blocked',
      runnable: false,
      summary: 'mi.target_temperature is missing argument(s): value.',
    })
  })
})

function insertBranchedWorkflow(db: ReturnType<typeof createInMemoryDb>) {
  const workflowId = Number(db.prepare(
    `INSERT INTO workflows (name, description, trigger_type, graph_json)
     VALUES (?, ?, 'manual', '{}')`,
  ).run('Runtime Branch Test', 'test workflow').lastInsertRowid)

  const insertNode = db.prepare(
    `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const startId = Number(insertNode.run(
    workflowId,
    'start',
    'Start',
    JSON.stringify({ x: 0, y: 0 }),
    JSON.stringify({ inputs: { intent: 'watch_tv' } }),
  ).lastInsertRowid)
  const conditionId = Number(insertNode.run(
    workflowId,
    'if_else',
    'Check Intent',
    JSON.stringify({ x: 220, y: 0 }),
    JSON.stringify({ left: '{{input.intent}}', operator: '==', right: 'watch_tv' }),
  ).lastInsertRowid)
  const answerId = Number(insertNode.run(
    workflowId,
    'answer',
    'Reply',
    JSON.stringify({ x: 440, y: 0 }),
    JSON.stringify({ message: 'route={{input.intent}} matched={{node.' + conditionId + '.condition_result}}' }),
  ).lastInsertRowid)

  const insertEdge = db.prepare(
    `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insertEdge.run(workflowId, startId, conditionId, 'out', 'in', '{}')
  insertEdge.run(workflowId, conditionId, answerId, 'true', 'in', '{}')

  db.prepare('UPDATE workflows SET graph_json = ? WHERE id = ?').run(
    JSON.stringify({
      nodes: [
        { id: startId, type: 'start', label: 'Start' },
        { id: conditionId, type: 'if_else', label: 'Check Intent' },
        { id: answerId, type: 'answer', label: 'Reply' },
      ],
      edges: [
        { source_node_id: startId, target_node_id: conditionId, source_port: 'out', target_port: 'in' },
        { source_node_id: conditionId, target_node_id: answerId, source_port: 'true', target_port: 'in' },
      ],
    }),
    workflowId,
  )

  return { workflowId, startId, conditionId, answerId }
}

function insertDeviceCapabilityWorkflow(db: ReturnType<typeof createInMemoryDb>) {
  db.prepare(`
    INSERT INTO user_devices (id, name, device_type, room_id, mi_did, adb_ip, ip_address)
    VALUES (?, ?, ?, NULL, ?, '', '')
  `).run(7, '客厅机顶盒', 'tv_box', 'mi.demo.ir')

  const workflowId = Number(db.prepare(
    `INSERT INTO workflows (name, description, trigger_type, graph_json)
     VALUES (?, ?, 'manual', '{}')`,
  ).run('Device Capability Runtime Test', 'test workflow').lastInsertRowid)

  const insertNode = db.prepare(
    `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const startId = Number(insertNode.run(
    workflowId,
    'start',
    'Start',
    JSON.stringify({ x: 0, y: 0 }),
    JSON.stringify({ inputs: { device_id: 7, capability_id: 'mi.ir_key', key: 'BACK' } }),
  ).lastInsertRowid)
  const deviceCapabilityId = Number(insertNode.run(
    workflowId,
    'device_capability',
    'Run Capability',
    JSON.stringify({ x: 220, y: 0 }),
    JSON.stringify({
      device_id: '{{input.device_id}}',
      capability_id: '{{input.capability_id}}',
      arguments: { key: '{{input.key}}' },
    }),
  ).lastInsertRowid)
  const answerId = Number(insertNode.run(
    workflowId,
    'answer',
    'Reply',
    JSON.stringify({ x: 440, y: 0 }),
    JSON.stringify({ message: 'capability={{node.' + deviceCapabilityId + '.result.status}}' }),
  ).lastInsertRowid)

  const insertEdge = db.prepare(
    `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insertEdge.run(workflowId, startId, deviceCapabilityId, 'out', 'in', '{}')
  insertEdge.run(workflowId, deviceCapabilityId, answerId, 'out', 'in', '{}')

  db.prepare('UPDATE workflows SET graph_json = ? WHERE id = ?').run(
    JSON.stringify({
      nodes: [
        { id: startId, type: 'start', label: 'Start' },
        { id: deviceCapabilityId, type: 'device_capability', label: 'Run Capability' },
        { id: answerId, type: 'answer', label: 'Reply' },
      ],
      edges: [
        { source_node_id: startId, target_node_id: deviceCapabilityId, source_port: 'out', target_port: 'in' },
        { source_node_id: deviceCapabilityId, target_node_id: answerId, source_port: 'out', target_port: 'in' },
      ],
    }),
    workflowId,
  )

  return { workflowId, deviceCapabilityId, answerId }
}

function insertExecutorCallWorkflow(db: ReturnType<typeof createInMemoryDb>) {
  const workflowId = Number(db.prepare(
    `INSERT INTO workflows (name, description, trigger_type, graph_json)
     VALUES (?, ?, 'manual', '{}')`,
  ).run('DLNA Cast Executor Runtime Test', 'executor workflow').lastInsertRowid)

  const insertNode = db.prepare(
    `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const startId = Number(insertNode.run(
    workflowId,
    'start',
    'Start',
    JSON.stringify({ x: 0, y: 0 }),
    JSON.stringify({ inputs: { base_url: 'http://127.0.0.1:9' } }),
  ).lastInsertRowid)
  const executorId = Number(insertNode.run(
    workflowId,
    'executor_call',
    'Discover DLNA Devices',
    JSON.stringify({ x: 220, y: 0 }),
    JSON.stringify({
      executor_name: 'cli.invoke',
      params: {
        cli_name: 'dlna-cast-cli',
        action: 'discover_devices',
        params: {
          base_url: '{{input.base_url}}',
        },
      },
    }),
  ).lastInsertRowid)
  const answerId = Number(insertNode.run(
    workflowId,
    'answer',
    'Reply',
    JSON.stringify({ x: 440, y: 0 }),
    JSON.stringify({ message: 'should not run' }),
  ).lastInsertRowid)

  const insertEdge = db.prepare(
    `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insertEdge.run(workflowId, startId, executorId, 'out', 'in', '{}')
  insertEdge.run(workflowId, executorId, answerId, 'out', 'in', '{}')

  db.prepare('UPDATE workflows SET graph_json = ? WHERE id = ?').run(
    JSON.stringify({
      nodes: [
        { id: startId, type: 'start', label: 'Start' },
        { id: executorId, type: 'executor_call', label: 'Discover DLNA Devices' },
        { id: answerId, type: 'answer', label: 'Reply' },
      ],
      edges: [
        { source_node_id: startId, target_node_id: executorId, source_port: 'out', target_port: 'in' },
        { source_node_id: executorId, target_node_id: answerId, source_port: 'out', target_port: 'in' },
      ],
    }),
    workflowId,
  )

  return { workflowId, startId, executorId, answerId }
}

function insertSubflowWorkflow(db: ReturnType<typeof createInMemoryDb>) {
  const childWorkflowId = Number(db.prepare(
    `INSERT INTO workflows (name, description, trigger_type, graph_json)
     VALUES (?, ?, 'manual', '{}')`,
  ).run('Child Runtime Test', 'child workflow').lastInsertRowid)

  const insertNode = db.prepare(
    `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const childStartId = Number(insertNode.run(
    childWorkflowId,
    'start',
    'Child Start',
    JSON.stringify({ x: 0, y: 0 }),
    JSON.stringify({ inputs: {} }),
  ).lastInsertRowid)
  const childAnswerId = Number(insertNode.run(
    childWorkflowId,
    'answer',
    'Child Answer',
    JSON.stringify({ x: 220, y: 0 }),
    JSON.stringify({ message: '{{input.message}}' }),
  ).lastInsertRowid)

  const insertEdge = db.prepare(
    `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insertEdge.run(childWorkflowId, childStartId, childAnswerId, 'out', 'in', '{}')

  const parentWorkflowId = Number(db.prepare(
    `INSERT INTO workflows (name, description, trigger_type, graph_json)
     VALUES (?, ?, 'manual', '{}')`,
  ).run('Parent Runtime Test', 'parent workflow').lastInsertRowid)
  const parentStartId = Number(insertNode.run(
    parentWorkflowId,
    'start',
    'Parent Start',
    JSON.stringify({ x: 0, y: 0 }),
    JSON.stringify({ inputs: {} }),
  ).lastInsertRowid)
  const subflowId = Number(insertNode.run(
    parentWorkflowId,
    'subflow',
    'Run Child',
    JSON.stringify({ x: 220, y: 0 }),
    JSON.stringify({
      workflow_id: childWorkflowId,
      inputs: { message: '{{input.message}}' },
      output_key: 'answer',
    }),
  ).lastInsertRowid)
  const parentAnswerId = Number(insertNode.run(
    parentWorkflowId,
    'answer',
    'Parent Answer',
    JSON.stringify({ x: 440, y: 0 }),
    JSON.stringify({ message: 'parent saw: {{node.' + subflowId + '.value}}' }),
  ).lastInsertRowid)

  insertEdge.run(parentWorkflowId, parentStartId, subflowId, 'out', 'in', '{}')
  insertEdge.run(parentWorkflowId, subflowId, parentAnswerId, 'out', 'in', '{}')

  return {
    childWorkflowId,
    parentWorkflowId,
    childStartId,
    childAnswerId,
    parentStartId,
    subflowId,
    parentAnswerId,
  }
}

function insertRecursiveSubflowWorkflow(db: ReturnType<typeof createInMemoryDb>) {
  const workflowId = Number(db.prepare(
    `INSERT INTO workflows (name, description, trigger_type, graph_json)
     VALUES (?, ?, 'manual', '{}')`,
  ).run('Recursive Subflow Runtime Test', 'recursive workflow').lastInsertRowid)

  const insertNode = db.prepare(
    `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const startId = Number(insertNode.run(
    workflowId,
    'start',
    'Start',
    JSON.stringify({ x: 0, y: 0 }),
    JSON.stringify({ inputs: { message: 'loop' } }),
  ).lastInsertRowid)
  const subflowId = Number(insertNode.run(
    workflowId,
    'subflow',
    'Loop',
    JSON.stringify({ x: 220, y: 0 }),
    JSON.stringify({
      workflow_id: workflowId,
      inputs: { message: '{{input.message}}' },
    }),
  ).lastInsertRowid)
  const answerId = Number(insertNode.run(
    workflowId,
    'answer',
    'Reply',
    JSON.stringify({ x: 440, y: 0 }),
    JSON.stringify({ message: 'should not reach' }),
  ).lastInsertRowid)

  const insertEdge = db.prepare(
    `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insertEdge.run(workflowId, startId, subflowId, 'out', 'in', '{}')
  insertEdge.run(workflowId, subflowId, answerId, 'out', 'in', '{}')

  db.prepare('UPDATE workflows SET graph_json = ? WHERE id = ?').run(
    JSON.stringify({
      nodes: [
        { id: startId, type: 'start', label: 'Start' },
        { id: subflowId, type: 'subflow', label: 'Loop' },
        { id: answerId, type: 'answer', label: 'Reply' },
      ],
      edges: [
        { source_node_id: startId, target_node_id: subflowId, source_port: 'out', target_port: 'in' },
        { source_node_id: subflowId, target_node_id: answerId, source_port: 'out', target_port: 'in' },
      ],
    }),
    workflowId,
  )

  return { workflowId, startId, subflowId, answerId }
}

function insertFailingCodeWorkflow(db: ReturnType<typeof createInMemoryDb>) {
  const workflowId = Number(db.prepare(
    `INSERT INTO workflows (name, description, trigger_type, graph_json)
     VALUES (?, ?, 'manual', '{}')`,
  ).run('Failing Runtime Test', 'test workflow').lastInsertRowid)

  const insertNode = db.prepare(
    `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const startId = Number(insertNode.run(
    workflowId,
    'start',
    'Start',
    JSON.stringify({ x: 0, y: 0 }),
    JSON.stringify({ inputs: { intent: 'fail_demo' } }),
  ).lastInsertRowid)
  const codeId = Number(insertNode.run(
    workflowId,
    'code',
    'Explode',
    JSON.stringify({ x: 220, y: 0 }),
    JSON.stringify({ code: 'throw new Error("boom")' }),
  ).lastInsertRowid)
  const answerId = Number(insertNode.run(
    workflowId,
    'answer',
    'Reply',
    JSON.stringify({ x: 440, y: 0 }),
    JSON.stringify({ message: 'should not run' }),
  ).lastInsertRowid)

  const insertEdge = db.prepare(
    `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insertEdge.run(workflowId, startId, codeId, 'out', 'in', '{}')
  insertEdge.run(workflowId, codeId, answerId, 'out', 'in', '{}')

  return { workflowId, startId, codeId, answerId }
}

function insertRetryCodeWorkflow(db: ReturnType<typeof createInMemoryDb>) {
  const workflowId = Number(db.prepare(
    `INSERT INTO workflows (name, description, trigger_type, graph_json)
     VALUES (?, ?, 'manual', '{}')`,
  ).run('Retry Runtime Test', 'retry workflow').lastInsertRowid)

  const insertNode = db.prepare(
    `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json)
     VALUES (?, ?, ?, ?, ?)`,
  )
  const startId = Number(insertNode.run(
    workflowId,
    'start',
    'Start',
    JSON.stringify({ x: 0, y: 0 }),
    JSON.stringify({ inputs: {} }),
  ).lastInsertRowid)
  const codeId = Number(insertNode.run(
    workflowId,
    'code',
    'Retry Once',
    JSON.stringify({ x: 220, y: 0 }),
    JSON.stringify({
      retry: { max_attempts: 2, delay_ms: 0 },
      code: `
        globalThis.__workflowRetryCount = (globalThis.__workflowRetryCount ?? 0) + 1;
        if (globalThis.__workflowRetryCount < 2) {
          throw new Error('temporary');
        }
        return { ok: true };
      `,
    }),
  ).lastInsertRowid)
  const answerId = Number(insertNode.run(
    workflowId,
    'answer',
    'Reply',
    JSON.stringify({ x: 440, y: 0 }),
    JSON.stringify({ message: 'retry={{node.' + codeId + '.ok}}' }),
  ).lastInsertRowid)

  const insertEdge = db.prepare(
    `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insertEdge.run(workflowId, startId, codeId, 'out', 'in', '{}')
  insertEdge.run(workflowId, codeId, answerId, 'out', 'in', '{}')

  return { workflowId, startId, codeId, answerId }
}
