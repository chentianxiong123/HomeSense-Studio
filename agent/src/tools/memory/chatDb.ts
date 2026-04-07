import { existsSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import Database from "better-sqlite3";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "chat.db");

export interface ChatMessage {
  id: number;
  role: string;
  content: string;
  created_at: string;
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
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  return db;
}

export function saveMessage(role: string, content: string): ChatMessage {
  const db = ensureDb();
  const stmt = db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)");
  const result = stmt.run(role, content);

  const query = db.prepare("SELECT id, role, content, created_at FROM messages WHERE id = ?");
  const row = query.get(result.lastInsertRowid) as ChatMessage;

  db.close();
  return row;
}

export function getMessages(limit: number, offset: number): ChatMessage[] {
  const db = ensureDb();
  const stmt = db.prepare(
    "SELECT id, role, content, created_at FROM messages LIMIT ? OFFSET ?"
  );
  const rows = stmt.all(limit, offset) as ChatMessage[];
  db.close();
  return rows;
}

export function getRecentMessages(limit: number): ChatMessage[] {
  const db = ensureDb();
  const stmt = db.prepare(
    "SELECT id, role, content, created_at FROM messages ORDER BY id DESC LIMIT ?"
  );
  const rows = stmt.all(limit) as ChatMessage[];
  db.close();
  return rows.reverse();
}

export function getRecentUserMessages(limit: number): ChatMessage[] {
  const db = ensureDb();
  const stmt = db.prepare(
    "SELECT id, role, content, created_at FROM messages WHERE role = ? ORDER BY id DESC LIMIT ?"
  );
  const rows = stmt.all("user", limit) as ChatMessage[];
  db.close();
  return rows.reverse();
}

export function getMessageCount(): number {
  const db = ensureDb();
  const stmt = db.prepare("SELECT COUNT(*) as count FROM messages");
  const result = stmt.get() as { count: number };
  db.close();
  return result.count;
}
