import Fastify from 'fastify'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import * as dbModule from '../../db/index.js'
import { workflowRoutes } from './routes.js'

describe('workflow routes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects publishing to Chat before a workflow has proven evidence', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    const app = Fastify()
    await app.register(workflowRoutes)

    db.prepare(`
      INSERT INTO workflows (id, name, description, trigger_type, published, graph_json, graph_updated_at)
      VALUES (7, 'Draft Flow', '', 'manual', 0, ?, '2026-05-31 07:59:00')
    `).run(JSON.stringify({ nodes: [{ type: 'start', label: 'Start' }], edges: [] }))
    db.prepare(`
      INSERT INTO workflow_nodes (id, workflow_id, type, label, position_json, config_json)
      VALUES (11, 7, 'start', 'Start', ?, ?)
    `).run(JSON.stringify({ x: 10, y: 20 }), JSON.stringify({ inputs: {} }))

    const response = await app.inject({
      method: 'PUT',
      url: '/api/workflows/7',
      payload: { published: true },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body).toMatchObject({
      status: 'error',
      error: 'PUBLISH_EVIDENCE_REQUIRED',
      run_quality: expect.objectContaining({
        evidence_status: 'untested',
      }),
    })
    const row = db.prepare('SELECT published, graph_json FROM workflows WHERE id = 7').get() as {
      published: number
      graph_json: string
    }
    expect(row.published).toBe(0)
    expect(JSON.parse(row.graph_json)).toEqual({
      nodes: [{ type: 'start', label: 'Start' }],
      edges: [],
    })

    await app.close()
  })

  it('updates publish state after the workflow has proven evidence without wiping the graph snapshot', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    const app = Fastify()
    await app.register(workflowRoutes)

    db.prepare(`
      INSERT INTO workflows (id, name, description, trigger_type, published, graph_json, graph_updated_at)
      VALUES (7, 'Draft Flow', '', 'manual', 0, ?, '2026-05-31 07:59:00')
    `).run(JSON.stringify({ nodes: [{ type: 'start', label: 'Start' }], edges: [] }))
    db.prepare(`
      INSERT INTO workflow_nodes (id, workflow_id, type, label, position_json, config_json)
      VALUES (11, 7, 'start', 'Start', ?, ?)
    `).run(JSON.stringify({ x: 10, y: 20 }), JSON.stringify({ inputs: {} }))
    db.prepare(`
      INSERT INTO workflow_runs (workflow_id, status, triggered_by, started_at, finished_at, result_json, inputs_json, trace_json, events_json)
      VALUES (7, 'succeeded', 'manual', '2026-05-31 08:00:00', '2026-05-31 08:00:01', '{}', '{}', '[]', '[]')
    `).run()

    const response = await app.inject({
      method: 'PUT',
      url: '/api/workflows/7',
      payload: { published: true },
    })

    expect(response.statusCode).toBe(200)
    const row = db.prepare('SELECT published, graph_json FROM workflows WHERE id = 7').get() as {
      published: number
      graph_json: string
    }
    expect(row.published).toBe(1)
    expect(JSON.parse(row.graph_json)).toEqual({
      nodes: [{ type: 'start', label: 'Start' }],
      edges: [],
    })

    await app.close()
  })

  it('rejects publishing when the only success predates the current graph', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    const app = Fastify()
    await app.register(workflowRoutes)

    db.prepare(`
      INSERT INTO workflows (id, name, description, trigger_type, published, graph_json, graph_updated_at)
      VALUES (9, 'Changed Flow', '', 'manual', 0, ?, '2026-05-31 10:00:00')
    `).run(JSON.stringify({ nodes: [{ type: 'start', label: 'Start' }], edges: [] }))
    insertRun(db, {
      workflowId: 9,
      status: 'succeeded',
      startedAt: '2026-05-31 08:00:00',
      finishedAt: '2026-05-31 08:00:01',
    })

    const response = await app.inject({
      method: 'PUT',
      url: '/api/workflows/9',
      payload: { published: true },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body).toMatchObject({
      status: 'error',
      error: 'PUBLISH_EVIDENCE_REQUIRED',
      run_quality: expect.objectContaining({
        evidence_status: 'untested',
        success_count: 0,
      }),
    })
    const row = db.prepare('SELECT published FROM workflows WHERE id = 9').get() as { published: number }
    expect(row.published).toBe(0)

    await app.close()
  })

  it('rejects publishing when same-second success belongs to a different graph hash', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    const app = Fastify()
    await app.register(workflowRoutes)

    db.prepare(`
      INSERT INTO workflows (id, name, description, trigger_type, published, graph_json, graph_hash, graph_updated_at)
      VALUES (12, 'Hash Changed Flow', '', 'manual', 0, ?, 'current_graph_hash', '2026-05-31 10:00:00')
    `).run(JSON.stringify({ nodes: [{ type: 'start', label: 'Start' }], edges: [] }))
    insertRun(db, {
      workflowId: 12,
      status: 'succeeded',
      startedAt: '2026-05-31 09:59:59',
      finishedAt: '2026-05-31 10:00:00',
      graphHash: 'previous_graph_hash',
    })

    const response = await app.inject({
      method: 'PUT',
      url: '/api/workflows/12',
      payload: { published: true },
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body).toMatchObject({
      status: 'error',
      error: 'PUBLISH_EVIDENCE_REQUIRED',
      run_quality: expect.objectContaining({
        evidence_status: 'untested',
        total_runs: 0,
      }),
    })

    await app.close()
  })

  it('keeps graph evidence when saving a logically identical graph', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    const app = Fastify()
    await app.register(workflowRoutes)

    const graph = {
      nodes: [{
        id: 11,
        type: 'start',
        label: 'Start',
        position: { x: 10, y: 20 },
        config: { inputs: {} },
      }],
      edges: [],
    }
    db.prepare(`
      INSERT INTO workflows (id, name, description, trigger_type, published, graph_json, graph_updated_at)
      VALUES (10, 'Stable Flow', '', 'manual', 0, ?, '2026-05-31 07:59:00')
    `).run(JSON.stringify(graph))
    db.prepare(`
      INSERT INTO workflow_nodes (id, workflow_id, type, label, position_json, config_json)
      VALUES (11, 10, 'start', 'Start', ?, ?)
    `).run(JSON.stringify({ x: 10, y: 20 }), JSON.stringify({ inputs: {} }))
    insertRun(db, {
      workflowId: 10,
      status: 'succeeded',
      startedAt: '2026-05-31 08:00:00',
      finishedAt: '2026-05-31 08:00:01',
    })

    const response = await app.inject({
      method: 'PUT',
      url: '/api/workflows/10',
      payload: {
        nodes: [{
          id: 11,
          type: 'start',
          label: 'Start',
          position: { x: 10, y: 20 },
          config: { inputs: {} },
        }],
        edges: [],
      },
    })

    expect(response.statusCode).toBe(200)
    const row = db.prepare('SELECT graph_updated_at FROM workflows WHERE id = 10').get() as { graph_updated_at: string }
    expect(row.graph_updated_at).toBe('2026-05-31 07:59:00')

    const detail = await app.inject({
      method: 'GET',
      url: '/api/workflows/10',
    })
    expect(JSON.parse(detail.body).run_quality).toMatchObject({
      evidence_status: 'proven',
      success_count: 1,
    })

    await app.close()
  })

  it('returns workflow run quality with workflow detail', async () => {
    const db = createInMemoryDb()
    vi.spyOn(dbModule, 'getDb').mockReturnValue(db)
    const app = Fastify()
    await app.register(workflowRoutes)

    db.prepare(`
      INSERT INTO workflows (id, name, description, trigger_type, published, graph_json, graph_updated_at)
      VALUES (8, 'Quality Flow', '', 'manual', 1, '{}', '2026-05-31 07:59:00')
    `).run()
    insertRun(db, {
      workflowId: 8,
      status: 'succeeded',
      startedAt: '2026-05-31 08:00:00',
      finishedAt: '2026-05-31 08:00:01',
      inputs: { device_id: 2, app: 'bilibili' },
    })
    insertRun(db, {
      workflowId: 8,
      status: 'failed',
      startedAt: '2026-05-31 09:00:00',
      finishedAt: '2026-05-31 09:00:02',
    })

    const response = await app.inject({
      method: 'GET',
      url: '/api/workflows/8',
    })

    expect(response.statusCode).toBe(200)
    const body = JSON.parse(response.body)
    expect(body.run_quality).toEqual({
      workflow_id: 8,
      total_runs: 2,
      success_count: 1,
      failure_count: 1,
      last_run_status: 'failed',
      last_run_at: '2026-05-31 09:00:02',
      last_success_at: '2026-05-31 08:00:01',
      last_success_inputs_json: JSON.stringify({ device_id: 2, app: 'bilibili' }),
      last_success_input_keys: ['device_id', 'app'],
      evidence_status: 'regressed',
    })

    await app.close()
  })
})

function insertRun(
  db: ReturnType<typeof createInMemoryDb>,
  input: {
    workflowId: number
    status: 'succeeded' | 'failed'
    startedAt: string
    finishedAt: string
    inputs?: Record<string, unknown>
    graphHash?: string
  },
): void {
  db.prepare(`
    INSERT INTO workflow_runs (workflow_id, status, triggered_by, started_at, finished_at, result_json, inputs_json, trace_json, graph_hash)
    VALUES (?, ?, 'manual', ?, ?, '{}', ?, '[]', ?)
  `).run(input.workflowId, input.status, input.startedAt, input.finishedAt, JSON.stringify(input.inputs ?? {}), input.graphHash ?? '')
}
