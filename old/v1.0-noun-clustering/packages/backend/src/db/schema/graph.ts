import type Database from 'better-sqlite3'

/**
 * Schema module: graph
 * Generic graph nodes and edges for spatial maps and knowledge graphs.
 *
 * Source of truth: the live DB. To regenerate this file, run
 *   node scripts/.dump-db.mjs
 * and copy graph into here. The orchestrator (db/index.ts) applies
 * tables + indexes in order, then calls apply() for any domain migrations.
 */
export const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS graph_edges (
      id INTEGER NOT NULL,
      from_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      to_node_id TEXT NOT NULL REFERENCES graph_nodes(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), confidence REAL NOT NULL DEFAULT 1.0, valid_from TEXT NOT NULL DEFAULT (datetime('now')), valid_to TEXT NULL, source_type TEXT NOT NULL DEFAULT '', source_ref TEXT NOT NULL DEFAULT '',
      PRIMARY KEY (id AUTOINCREMENT),
      UNIQUE (from_node_id, to_node_id, relation)
    )`,
  `CREATE TABLE IF NOT EXISTS graph_nodes (
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      label TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '',
      embedding_ref TEXT NOT NULL DEFAULT '',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id)
    )`,
]

export const indexes: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_graph_edges_from ON graph_edges(from_node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_graph_edges_relation ON graph_edges(relation)`,
  `CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_type, source_ref)`,
  `CREATE INDEX IF NOT EXISTS idx_graph_edges_to ON graph_edges(to_node_id)`,
  `CREATE INDEX IF NOT EXISTS idx_graph_edges_valid ON graph_edges(valid_from, valid_to)`,
  `CREATE INDEX IF NOT EXISTS idx_graph_nodes_label ON graph_nodes(label)`,
  `CREATE INDEX IF NOT EXISTS idx_graph_nodes_scope ON graph_nodes(scope)`,
  `CREATE INDEX IF NOT EXISTS idx_graph_nodes_type ON graph_nodes(type)`,
]

export function apply(_db: Database.Database): void {
  // Domain-specific migrations for graph.
}
