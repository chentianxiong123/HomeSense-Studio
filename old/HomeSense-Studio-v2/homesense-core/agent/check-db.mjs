import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "src/tools/memory/chat.db");

console.log("数据库路径:", DB_PATH);

const db = new Database(DB_PATH);

// 检查消息数量
const count = db.prepare("SELECT COUNT(*) as count FROM messages").get();
console.log("\n消息总数:", count.count);

// 检查表结构
const columns = db.prepare("PRAGMA table_info(messages)").all();
console.log("\n表结构:");
columns.forEach(col => console.log("  -", col.name, col.type));

// 获取最近20条消息
const messages = db.prepare("SELECT id, role, content, created_at FROM messages ORDER BY id DESC LIMIT 20").all();
console.log("\n最近20条消息:");
messages.forEach(msg => {
  const content = msg.content.slice(0, 50);
  console.log(`  [${msg.id}] ${msg.role}: ${content}${msg.content.length > 50 ? '...' : ''}`);
});

db.close();
console.log("\n检查完成");
