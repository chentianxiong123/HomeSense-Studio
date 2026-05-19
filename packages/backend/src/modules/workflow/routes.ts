import type { FastifyInstance } from 'fastify'
import { getDb } from '../../db/index.js'
import { workflowRuntime } from './run-workflow.js'
import { workflowNodeDefinitionRegistry } from './node-definitions.js'
import { workflowPreviewService } from './preview-workflow.js'
import { workflowSeedService } from './seed.js'

export async function workflowRoutes(app: FastifyInstance) {
  app.get('/api/workflows/node-definitions', async () => {
    return { node_definitions: workflowNodeDefinitionRegistry.list() }
  })

  app.get('/api/workflows', async () => {
    const db = getDb()
    const workflows = db.prepare('SELECT * FROM workflows ORDER BY updated_at DESC').all()
    return { workflows }
  })

  app.post('/api/workflows/reseed-defaults', async (request) => {
    const body = (request.body as { overwrite?: boolean } | undefined) ?? {}
    const result = workflowSeedService.syncDefaults({ overwrite: body.overwrite === true })
    return { status: 'success', data: result }
  })

  app.post('/api/workflows', async (request) => {
    const body = request.body as {
      name: string
      description?: string
      trigger_type?: 'manual' | 'cron' | 'chat'
      cron_expression?: string
      nodes?: Array<{ type: string; label: string; config?: Record<string, unknown>; position?: { x: number; y: number } }>
      edges?: Array<{ source_node_id: number; target_node_id: number; source_port?: string; target_port?: string; condition?: Record<string, unknown> }>
    }

    if (!body.name) {
      return { status: 'error', error: 'INVALID_PARAMS', message: '缺少 name 参数' }
    }

    if (body.nodes && !validateNodeTypes(body.nodes)) {
      return { status: 'error', error: 'INVALID_NODE_TYPE', message: 'Unknown workflow node type' }
    }

    const db = getDb()
    const result = db.prepare(
      `INSERT INTO workflows (name, description, trigger_type, cron_expression) VALUES (?, ?, ?, ?)`,
    ).run(body.name, body.description ?? '', body.trigger_type ?? 'manual', body.cron_expression ?? null)

    const workflowId = Number(result.lastInsertRowid)

    if (body.nodes?.length) {
      const insertNode = db.prepare(
        `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json) VALUES (?, ?, ?, ?, ?)`,
      )
      const insertedNodeIds: number[] = []
      for (const node of body.nodes) {
        const nodeResult = insertNode.run(
          workflowId,
          node.type,
          node.label,
          JSON.stringify(node.position ?? { x: 0, y: 0 }),
          JSON.stringify(node.config ?? {}),
        )
        insertedNodeIds.push(Number(nodeResult.lastInsertRowid))
      }

      if (body.edges?.length) {
        const insertEdge = db.prepare(
          `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        for (const edge of body.edges) {
          const sourceNodeId = resolveSubmittedNodeRef(edge.source_node_id, insertedNodeIds, new Map())
          const targetNodeId = resolveSubmittedNodeRef(edge.target_node_id, insertedNodeIds, new Map())
          if (sourceNodeId == null || targetNodeId == null) continue
          insertEdge.run(
            workflowId,
            sourceNodeId,
            targetNodeId,
            edge.source_port ?? 'out',
            edge.target_port ?? 'in',
            JSON.stringify(edge.condition ?? {}),
          )
        }
      }
    }

    const graphJson = JSON.stringify({ nodes: body.nodes ?? [], edges: body.edges ?? [] })
    db.prepare('UPDATE workflows SET graph_json = ? WHERE id = ?').run(graphJson, workflowId)

    return { status: 'success', data: { id: workflowId } }
  })

  app.get('/api/workflows/:id', async (request) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(Number(id))
    if (!workflow) {
      return { status: 'error', error: 'NOT_FOUND' }
    }
    const nodes = db.prepare('SELECT * FROM workflow_nodes WHERE workflow_id = ?').all(Number(id))
    const edges = db.prepare('SELECT * FROM workflow_edges WHERE workflow_id = ?').all(Number(id))
    return { workflow, nodes, edges }
  })

  app.put('/api/workflows/:id', async (request) => {
    const { id } = request.params as { id: string }
    const body = request.body as {
      name?: string
      description?: string
      trigger_type?: string
      cron_expression?: string
      published?: boolean
      nodes?: Array<{ id?: number; type: string; label: string; config?: Record<string, unknown>; position?: { x: number; y: number } }>
      edges?: Array<{ source_node_id: number; target_node_id: number; source_port?: string; target_port?: string; condition?: Record<string, unknown> }>
    }

    const db = getDb()
    const workflowId = Number(id)

    const existing = db.prepare('SELECT * FROM workflows WHERE id = ?').get(workflowId)
    if (!existing) {
      return { status: 'error', error: 'NOT_FOUND' }
    }
    if (body.nodes && !validateNodeTypes(body.nodes)) {
      return { status: 'error', error: 'INVALID_NODE_TYPE', message: 'Unknown workflow node type' }
    }

    if (body.name !== undefined || body.description !== undefined || body.trigger_type !== undefined || body.published !== undefined) {
      const updates: string[] = []
      const values: unknown[] = []

      if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name) }
      if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description) }
      if (body.trigger_type !== undefined) { updates.push('trigger_type = ?'); values.push(body.trigger_type) }
      if (body.cron_expression !== undefined) { updates.push('cron_expression = ?'); values.push(body.cron_expression) }
      if (body.published !== undefined) { updates.push('published = ?'); values.push(body.published ? 1 : 0) }

      if (updates.length > 0) {
        updates.push("updated_at = datetime('now')")
        db.prepare(`UPDATE workflows SET ${updates.join(', ')} WHERE id = ?`).run(...values, workflowId)
      }
    }

    if (body.nodes !== undefined) {
      db.prepare('DELETE FROM workflow_nodes WHERE workflow_id = ?').run(workflowId)
      const insertNode = db.prepare(
        `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json) VALUES (?, ?, ?, ?, ?)`,
      )
      const insertedNodeIds: number[] = []
      const oldNodeIdMap = new Map<number, number>()
      for (const [index, node] of body.nodes.entries()) {
        const result = insertNode.run(
          workflowId,
          node.type,
          node.label,
          JSON.stringify(node.position ?? { x: 0, y: 0 }),
          JSON.stringify(node.config ?? {}),
        )
        const insertedId = Number(result.lastInsertRowid)
        insertedNodeIds.push(insertedId)
        if (node.id != null) {
          oldNodeIdMap.set(Number(node.id), insertedId)
        }
      }

      if (body.edges !== undefined) {
        db.prepare('DELETE FROM workflow_edges WHERE workflow_id = ?').run(workflowId)
        const insertEdge = db.prepare(
          `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        for (const edge of body.edges) {
          const sourceNodeId = resolveSubmittedNodeRef(edge.source_node_id, insertedNodeIds, oldNodeIdMap)
          const targetNodeId = resolveSubmittedNodeRef(edge.target_node_id, insertedNodeIds, oldNodeIdMap)
          if (sourceNodeId == null || targetNodeId == null) continue
          insertEdge.run(
            workflowId,
            sourceNodeId,
            targetNodeId,
            edge.source_port ?? 'out',
            edge.target_port ?? 'in',
            JSON.stringify(edge.condition ?? {}),
          )
        }
      }
    } else if (body.edges !== undefined) {
      db.prepare('DELETE FROM workflow_edges WHERE workflow_id = ?').run(workflowId)
    }

    const graphJson = JSON.stringify({ nodes: body.nodes ?? [], edges: body.edges ?? [] })
    db.prepare('UPDATE workflows SET graph_json = ?, updated_at = datetime(\'now\') WHERE id = ?').run(graphJson, workflowId)

    return { status: 'success' }
  })

  app.delete('/api/workflows/:id', async (request) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    db.prepare('DELETE FROM workflows WHERE id = ?').run(Number(id))
    return { status: 'success' }
  })

  app.post('/api/workflows/:id/run', async (request) => {
    const { id } = request.params as { id: string }
    const body = (request.body as { inputs?: Record<string, unknown> }) ?? {}
    try {
      const result = await workflowRuntime.runWorkflow(Number(id), body.inputs ?? {})
      return { status: 'success', data: result }
    } catch (err) {
      return { status: 'error', error: 'WORKFLOW_ERROR', message: (err as Error).message }
    }
  })

  app.post('/api/workflows/:id/preview', async (request) => {
    const { id } = request.params as { id: string }
    const body = (request.body as { inputs?: Record<string, unknown> }) ?? {}
    try {
      const result = workflowPreviewService.previewWorkflow(Number(id), body.inputs ?? {})
      return { status: 'success', data: result }
    } catch (err) {
      return { status: 'error', error: 'WORKFLOW_PREVIEW_ERROR', message: (err as Error).message }
    }
  })

  app.get('/api/workflows/:id/runs', async (request) => {
    const { id } = request.params as { id: string }
    const db = getDb()
    const runs = db.prepare(
      'SELECT * FROM workflow_runs WHERE workflow_id = ? ORDER BY started_at DESC LIMIT 20',
    ).all(Number(id))
    return { runs }
  })
}

function resolveSubmittedNodeRef(
  rawRef: number,
  insertedNodeIds: number[],
  oldNodeIdMap: Map<number, number>,
): number | null {
  const numericRef = Number(rawRef)
  if (oldNodeIdMap.has(numericRef)) return oldNodeIdMap.get(numericRef)!
  if (Number.isInteger(numericRef) && numericRef >= 0 && numericRef < insertedNodeIds.length) {
    return insertedNodeIds[numericRef]
  }
  return null
}

function validateNodeTypes(nodes: Array<{ type: string }>): boolean {
  return nodes.every((node) => workflowNodeDefinitionRegistry.has(node.type))
}
