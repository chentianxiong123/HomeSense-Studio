import type Database from 'better-sqlite3'

/**
 * Schema module: workflow
 * Workflows, nodes, edges, runs.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy workflow into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS workflow_edges (
      id INTEGER NOT NULL, workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      source_node_id INTEGER NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
      target_node_id INTEGER NOT NULL REFERENCES workflow_nodes(id) ON DELETE CASCADE,
      source_port TEXT NOT NULL DEFAULT 'out', target_port TEXT NOT NULL DEFAULT 'in',
      condition_json TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS "workflow_nodes" (
        id INTEGER NOT NULL,
        workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('start','schedule','device_control','xiaoai','ir_control','scene_execute','device_capability','llm','if_else','delay','parallel','code','answer','executor_call','subflow','knowledge_retrieve','candidate_plan_resolve','rerank_score','agent_dispatch')),
        position_json TEXT NOT NULL DEFAULT '{}',
        config_json TEXT NOT NULL DEFAULT '{}',
        label TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (id AUTOINCREMENT)
      )`,
  `CREATE TABLE IF NOT EXISTS workflow_runs (
      id INTEGER NOT NULL, workflow_id INTEGER NOT NULL REFERENCES workflows(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending','running','succeeded','failed')) DEFAULT 'pending',
      triggered_by TEXT NOT NULL CHECK (triggered_by IN ('manual','cron','chat')),
      started_at TEXT NULL, finished_at TEXT NULL, result_json TEXT NOT NULL DEFAULT '{}', inputs_json TEXT NOT NULL DEFAULT '{}', trace_json TEXT NOT NULL DEFAULT '[]', events_json TEXT NOT NULL DEFAULT '[]', graph_hash TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
  `CREATE TABLE IF NOT EXISTS workflows (
      id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
      graph_json TEXT NOT NULL DEFAULT '{}',
      trigger_type TEXT NOT NULL CHECK (trigger_type IN ('manual','cron','chat')) DEFAULT 'manual',
      cron_expression TEXT NULL, published INTEGER NOT NULL DEFAULT 0 CHECK (published IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), graph_updated_at TEXT NOT NULL DEFAULT '', graph_hash TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (id AUTOINCREMENT)
    )`,
]

export const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_workflow_edges_source ON workflow_edges(source_node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_edges_target ON workflow_edges(target_node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_edges_workflow_id ON workflow_edges(workflow_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_nodes_workflow_id ON workflow_nodes(workflow_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_graph_hash ON workflow_runs(workflow_id, graph_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_at ON workflow_runs(started_at)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status)`,
  `CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id)`,
  `CREATE INDEX IF NOT EXISTS idx_workflows_graph_hash ON workflows(graph_hash)`,
  `CREATE INDEX IF NOT EXISTS idx_workflows_published ON workflows(published)`,
  `CREATE INDEX IF NOT EXISTS idx_workflows_trigger_type ON workflows(trigger_type)`,
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for workflow.
}
