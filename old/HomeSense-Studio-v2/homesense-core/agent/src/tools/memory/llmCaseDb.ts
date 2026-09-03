import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "llm_cases.db");

export type LlmCaseStatus = "pending" | "success" | "failure" | "plan_only" | "non_executable";

function ensureDb(): Database.Database {
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_cases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input TEXT NOT NULL,
      normalized_intent TEXT,
      context_json TEXT,
      matched_candidates_json TEXT,
      status TEXT NOT NULL,
      final_response TEXT,
      linked_path_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  return db;
}

export function createPendingLlmCase(input: {
  rawInput: string;
  normalizedIntent?: string | null;
  context?: Record<string, unknown>;
  matchedCandidates?: Array<Record<string, unknown>>;
}): number {
  const db = ensureDb();
  const stmt = db.prepare(`
    INSERT INTO llm_cases (input, normalized_intent, context_json, matched_candidates_json, status)
    VALUES (?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    input.rawInput,
    input.normalizedIntent ?? null,
    input.context ? JSON.stringify(input.context) : null,
    input.matchedCandidates ? JSON.stringify(input.matchedCandidates) : null,
    "pending",
  );
  db.close();
  return Number(result.lastInsertRowid);
}

export function updateLlmCase(caseId: number, input: {
  status: LlmCaseStatus;
  finalResponse?: string | null;
  linkedPathId?: string | null;
}): void {
  const db = ensureDb();
  const stmt = db.prepare(`
    UPDATE llm_cases
    SET status = ?, final_response = ?, linked_path_id = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);
  stmt.run(input.status, input.finalResponse ?? null, input.linkedPathId ?? null, caseId);
  db.close();
}
