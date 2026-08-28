import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { readFileSync, mkdirSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { execSync } from "child_process";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface MemoryConfig {
  maxMessages: number;
  dbPath: string;
}

function loadConfig(): MemoryConfig {
  const configPath = join(__dirname, "config.yaml");
  try {
    const content = readFileSync(configPath, "utf-8");
    const config = YAML.parse(content);
    return {
      maxMessages: config.maxMessages || 100,
      dbPath: config.dbPath || "./memory.db",
    };
  } catch {
    return { maxMessages: 100, dbPath: "./memory.db" };
  }
}

function getDbPath(): string {
  const config = loadConfig();
  return join(__dirname, config.dbPath);
}

function ensureDb(): void {
  const dbPath = getDbPath();
  const dataDir = dirname(dbPath);
  
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const initSql = `
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session ON messages(session_id);
  `;

  try {
    execSync(`sqlite3 "${dbPath}" "${initSql}"`, { encoding: "utf-8" });
  } catch {}
}

export const memoryTool = tool(
  async (input) => {
    const { action, sessionId, role, content, limit } = input;
    ensureDb();
    const dbPath = getDbPath();

    switch (action) {
      case "save": {
        if (!role || !content) {
          return JSON.stringify({ success: false, error: "Missing role or content" });
        }
        const sid = sessionId || "default";
        const timestamp = Date.now();
        const sql = `INSERT INTO messages (session_id, role, content, timestamp) VALUES ('${sid}', '${role}', '${content.replace(/'/g, "''")}', ${timestamp})`;
        try {
          execSync(`sqlite3 "${dbPath}" "${sql}"`, { encoding: "utf-8" });
          return JSON.stringify({ success: true, saved: true });
        } catch (error) {
          return JSON.stringify({ success: false, error: String(error) });
        }
      }

      case "query": {
        const sid = sessionId || "default";
        const lim = limit || 100;
        const sql = `SELECT role, content, timestamp FROM messages WHERE session_id = '${sid}' ORDER BY timestamp DESC LIMIT ${lim}`;
        try {
          const result = execSync(`sqlite3 -json "${dbPath}" "${sql}"`, { encoding: "utf-8" });
          const messages = result ? JSON.parse(result) : [];
          return JSON.stringify({ success: true, messages: messages.reverse() });
        } catch {
          return JSON.stringify({ success: true, messages: [] });
        }
      }

      case "clear": {
        const sql = sessionId
          ? `DELETE FROM messages WHERE session_id = '${sessionId}'`
          : "DELETE FROM messages";
        try {
          execSync(`sqlite3 "${dbPath}" "${sql}"`, { encoding: "utf-8" });
          return JSON.stringify({ success: true, cleared: true });
        } catch (error) {
          return JSON.stringify({ success: false, error: String(error) });
        }
      }

      default:
        return JSON.stringify({ success: false, error: `Unknown action: ${action}` });
    }
  },
  {
    name: "memory",
    description: "对话历史存储和查询",
    schema: z.object({
      action: z.enum(["save", "query", "clear"]).describe("操作类型"),
      sessionId: z.string().optional().describe("会话ID"),
      role: z.enum(["user", "assistant", "system"]).optional().describe("消息角色"),
      content: z.string().optional().describe("消息内容"),
      limit: z.number().optional().describe("查询数量限制"),
    }),
  }
);
