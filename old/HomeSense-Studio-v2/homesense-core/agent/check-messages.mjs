import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "src/tools/memory/chat.db");

const db = new Database(DB_PATH);

// 检查消息总数
const count = db.prepare("SELECT COUNT(*) as count FROM messages").get();
console.log("消息总数:", count.count);

// 检查最小和最大ID
const idRange = db.prepare("SELECT MIN(id) as minId, MAX(id) as maxId FROM messages").get();
console.log("ID范围:", idRange.minId, "-", idRange.maxId);

// 模拟 getMessagesPage('latest', 20)
console.log("\n=== 模拟 getMessagesPage('latest', 20) ===");
const latest20 = db.prepare("SELECT id, role, content FROM messages ORDER BY id DESC LIMIT 20").all();
console.log("返回消息数:", latest20.length);
if (latest20.length > 0) {
  console.log("第一条(最新):", latest20[0].id, latest20[0].role);
  console.log("最后一条(最旧):", latest20[latest20.length-1].id, latest20[latest20.length-1].role);
  
  const oldestId = latest20[latest20.length-1].id;
  const hasOlder = db.prepare("SELECT 1 FROM messages WHERE id < ? LIMIT 1").get(oldestId);
  console.log("oldestCursorId:", oldestId);
  console.log("hasOlder:", !!hasOlder);
}

db.close();
