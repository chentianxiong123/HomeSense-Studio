import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
// 使用项目根目录下的 data 文件夹，确保 src 和 dist 使用同一个数据库
const DB_PATH = join(dirname(dirname(dirname(__dirname))), "data", "chat.db");

export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
  session_id?: string;
  is_clarification?: boolean;
  trace?: unknown[];
  writeBackResults?: unknown[];
  llm?: Record<string, unknown> | null;
  skillsHint?: string[];
  registryDebug?: Record<string, unknown> | null;
  workflowDraft?: Record<string, unknown> | null;
}

export interface ChatMessagePage {
  messages: ChatMessage[];
  pageInfo: {
    oldestCursorId: number | null;
    newestCursorId: number | null;
    hasOlder: boolean;
    hasNewer: boolean;
  };
}

export type MessagePageDirection = "latest" | "older" | "newer";

type PersistedMessagePayload = Pick<
  ChatMessage,
  "trace" | "writeBackResults" | "llm" | "skillsHint" | "registryDebug" | "workflowDraft"
>;

interface ChatMessageRow {
  id: number;
  role: string;
  content: string;
  created_at: string;
  session_id?: string;
  is_clarification?: number;
  payload_json?: string | null;
}

function ensureDb(): Database.Database {
  const dataDir = dirname(DB_PATH);
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      session_id TEXT,
      is_clarification INTEGER DEFAULT 0,
      payload_json TEXT
    );
  `);

  const columns = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
  const hasSessionId = columns.some((column) => column.name === "session_id");
  const hasClarification = columns.some((column) => column.name === "is_clarification");
  const hasPayloadJson = columns.some((column) => column.name === "payload_json");
  
  if (!hasSessionId) {
    db.exec("ALTER TABLE messages ADD COLUMN session_id TEXT");
  }
  if (!hasClarification) {
    db.exec("ALTER TABLE messages ADD COLUMN is_clarification INTEGER DEFAULT 0");
  }
  if (!hasPayloadJson) {
    db.exec("ALTER TABLE messages ADD COLUMN payload_json TEXT");
  }

  return db;
}

function buildPersistedPayload(payload?: PersistedMessagePayload): string | null {
  if (!payload) return null;

  const normalizedPayload = Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value != null)
  );

  return Object.keys(normalizedPayload).length > 0
    ? JSON.stringify(normalizedPayload)
    : null;
}

function parseMessageRow(row: ChatMessageRow): ChatMessage {
  let payload: PersistedMessagePayload = {};

  if (row.payload_json) {
    try {
      payload = JSON.parse(row.payload_json) as PersistedMessagePayload;
    } catch {
      payload = {};
    }
  }

  return {
    id: row.id,
    role: row.role,
    content: row.content,
    created_at: row.created_at,
    session_id: row.session_id,
    is_clarification: row.is_clarification === 1,
    trace: Array.isArray(payload.trace) ? payload.trace : [],
    writeBackResults: Array.isArray(payload.writeBackResults) ? payload.writeBackResults : [],
    llm: payload.llm ?? null,
    skillsHint: Array.isArray(payload.skillsHint) ? payload.skillsHint : [],
    registryDebug: payload.registryDebug ?? null,
    workflowDraft: payload.workflowDraft ?? null,
  };
}

export function saveMessage(
  role: string, 
  content: string, 
  payload?: PersistedMessagePayload,
  options?: { session_id?: string; is_clarification?: boolean }
): ChatMessage {
  const db = ensureDb();
  const stmt = db.prepare(
    "INSERT INTO messages (role, content, payload_json, session_id, is_clarification) VALUES (?, ?, ?, ?, ?)"
  );
  const result = stmt.run(
    role, 
    content, 
    buildPersistedPayload(payload),
    options?.session_id || null,
    options?.is_clarification ? 1 : 0
  );

  const query = db.prepare("SELECT id, role, content, created_at, session_id, is_clarification, payload_json FROM messages WHERE id = ?");
  const row = query.get(result.lastInsertRowid) as ChatMessageRow;

  db.close();
  return parseMessageRow(row);
}

export function getMessages(limit: number, offset: number): ChatMessage[] {
  const db = ensureDb();
  const stmt = db.prepare(
    "SELECT id, role, content, created_at, payload_json FROM messages ORDER BY id ASC LIMIT ? OFFSET ?"
  );
  const rows = stmt.all(limit, offset) as ChatMessageRow[];
  db.close();
  return rows.map(parseMessageRow);
}

export function getMessagesPage(
  limit: number,
  direction: MessagePageDirection = "latest",
  cursorId?: number,
): ChatMessagePage {
  const db = ensureDb();
  const normalizedLimit = Math.max(1, limit);

  let rows: ChatMessage[] = [];

  if (direction === "older" && typeof cursorId === "number") {
    const stmt = db.prepare(
      "SELECT id, role, content, created_at, payload_json FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?"
    );
    rows = (stmt.all(cursorId, normalizedLimit) as ChatMessageRow[]).map(parseMessageRow).reverse();
  } else if (direction === "newer" && typeof cursorId === "number") {
    const stmt = db.prepare(
      "SELECT id, role, content, created_at, payload_json FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?"
    );
    rows = (stmt.all(cursorId, normalizedLimit) as ChatMessageRow[]).map(parseMessageRow);
  } else {
    const stmt = db.prepare(
      "SELECT id, role, content, created_at, payload_json FROM messages ORDER BY id DESC LIMIT ?"
    );
    rows = (stmt.all(normalizedLimit) as ChatMessageRow[]).map(parseMessageRow).reverse();
  }

  const oldestCursorId = rows[0]?.id ?? null;
  const newestCursorId = rows[rows.length - 1]?.id ?? null;
  const hasOlder = oldestCursorId != null
    ? Boolean(db.prepare("SELECT 1 FROM messages WHERE id < ? LIMIT 1").get(oldestCursorId))
    : false;
  const hasNewer = newestCursorId != null
    ? Boolean(db.prepare("SELECT 1 FROM messages WHERE id > ? LIMIT 1").get(newestCursorId))
    : false;

  db.close();

  return {
    messages: rows,
    pageInfo: {
      oldestCursorId,
      newestCursorId,
      hasOlder,
      hasNewer,
    },
  };
}

export function getRecentMessages(limit: number): ChatMessage[] {
  const db = ensureDb();
  const stmt = db.prepare(
    "SELECT id, role, content, created_at, session_id, is_clarification, payload_json FROM messages ORDER BY id DESC LIMIT ?"
  );
  const rows = stmt.all(limit) as ChatMessageRow[];
  db.close();
  return rows.map(parseMessageRow).reverse();
}

export function getRecentUserMessages(limit: number): ChatMessage[] {
  const db = ensureDb();
  const stmt = db.prepare(
    "SELECT id, role, content, created_at, session_id, is_clarification, payload_json FROM messages WHERE role = ? ORDER BY id DESC LIMIT ?"
  );
  const rows = stmt.all("user", limit) as ChatMessageRow[];
  db.close();
  return rows.map(parseMessageRow).reverse();
}

export function getSmartContext(maxRounds: number = 2): Array<{role: string; content: string}> {
  const db = ensureDb();
  
  const lastAssistantStmt = db.prepare(
    "SELECT id, role, content, is_clarification FROM messages WHERE role = 'assistant' ORDER BY id DESC LIMIT 1"
  );
  const lastAssistant = lastAssistantStmt.get() as { id: number; role: string; content: string; is_clarification: number } | undefined;
  
  if (!lastAssistant || lastAssistant.is_clarification !== 1) {
    db.close();
    return [];
  }
  
  const contextStmt = db.prepare(
    `SELECT role, content FROM messages 
     WHERE id >= ? - ? * 2 
     ORDER BY id DESC 
     LIMIT ?`,
  );
  const rows = contextStmt.all(lastAssistant.id, maxRounds, maxRounds * 2) as Array<{ role: string; content: string }>;
  db.close();
  
  return rows.reverse().map(row => ({
    role: row.role,
    content: row.content.slice(0, 200),
  }));
}

export function getMessageCount(): number {
  const db = ensureDb();
  const stmt = db.prepare("SELECT COUNT(*) as count FROM messages");
  const result = stmt.get() as { count: number };
  db.close();
  return result.count;
}
