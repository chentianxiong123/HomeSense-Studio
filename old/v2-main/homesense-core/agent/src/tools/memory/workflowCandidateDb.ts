import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Database from "better-sqlite3";
import { createWorkflowV0, type WorkflowV0 } from "../../state.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "workflow_candidates.db");

export interface WorkflowCandidateRecord {
  id: number;
  workflowId: string;
  name: string;
  workflow: WorkflowV0;
  status: "pending" | "accepted";
  source: string | null;
  targetWorkflowId: string | null;
  targetWorkflowName: string | null;
  created_at: string;
  updated_at: string;
}

function ensureDb(): Database.Database {
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workflow_id TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      workflow_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      source TEXT,
      target_workflow_id TEXT,
      target_workflow_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

function normalizeWorkflow(value: string): WorkflowV0 {
  const parsed = JSON.parse(value) as WorkflowV0;
  return createWorkflowV0({
    workflowId: parsed.workflowId,
    name: parsed.name,
    description: parsed.description,
    goal: parsed.goal,
    inputs: parsed.inputs,
    nodes: parsed.nodes,
    edges: parsed.edges,
    metadata: parsed.metadata,
  });
}

function mapRow(row: Record<string, unknown>): WorkflowCandidateRecord {
  return {
    id: Number(row.id),
    workflowId: String(row.workflow_id),
    name: String(row.name),
    workflow: normalizeWorkflow(String(row.workflow_json)),
    status: row.status === "accepted" ? "accepted" : "pending",
    source: typeof row.source === "string" ? row.source : null,
    targetWorkflowId: typeof row.target_workflow_id === "string" ? row.target_workflow_id : null,
    targetWorkflowName: typeof row.target_workflow_name === "string" ? row.target_workflow_name : null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function listWorkflowCandidates(): WorkflowCandidateRecord[] {
  const db = ensureDb();
  const rows = db.prepare(`
    SELECT id, workflow_id, name, workflow_json, status, source, target_workflow_id, target_workflow_name, created_at, updated_at
    FROM workflow_candidates
    ORDER BY updated_at DESC, id DESC
  `).all() as Record<string, unknown>[];
  db.close();
  return rows.map(mapRow);
}

export function upsertWorkflowCandidate(input: {
  workflow: WorkflowV0;
  status?: "pending" | "accepted";
  source?: string | null;
  targetWorkflowId?: string | null;
  targetWorkflowName?: string | null;
}): WorkflowCandidateRecord {
  const db = ensureDb();
  db.prepare(`
    INSERT INTO workflow_candidates (
      workflow_id,
      name,
      workflow_json,
      status,
      source,
      target_workflow_id,
      target_workflow_name,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(workflow_id) DO UPDATE SET
      name = excluded.name,
      workflow_json = excluded.workflow_json,
      status = excluded.status,
      source = excluded.source,
      target_workflow_id = excluded.target_workflow_id,
      target_workflow_name = excluded.target_workflow_name,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    input.workflow.workflowId,
    input.workflow.name,
    JSON.stringify(input.workflow),
    input.status ?? "pending",
    input.source ?? null,
    input.targetWorkflowId ?? null,
    input.targetWorkflowName ?? null,
  );

  const row = db.prepare(`
    SELECT id, workflow_id, name, workflow_json, status, source, target_workflow_id, target_workflow_name, created_at, updated_at
    FROM workflow_candidates
    WHERE workflow_id = ?
  `).get(input.workflow.workflowId) as Record<string, unknown>;
  db.close();
  return mapRow(row);
}
