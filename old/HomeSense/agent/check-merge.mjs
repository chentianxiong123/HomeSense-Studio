import Database from "better-sqlite3";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = join(__dirname, "data", "chat.db");

console.log("数据库路径:", DB_PATH);

const db = new Database(DB_PATH);

// 检查消息总数
const count = db.prepare("SELECT COUNT(*) as count FROM messages").get();
console.log("\n消息总数:", count.count);

// 检查ID范围
const idRange = db.prepare("SELECT MIN(id) as minId, MAX(id) as maxId FROM messages").get();
console.log("ID范围:", idRange.minId, "-", idRange.maxId);

// 检查是否有ID重复
const duplicates = db.prepare(`
  SELECT id, COUNT(*) as cnt FROM messages 
  GROUP BY id 
  HAVING cnt > 1
`).all();
console.log("\n重复ID数量:", duplicates.length);
if (duplicates.length > 0) {
  console.log("重复的ID:", duplicates.map(d => d.id).slice(0, 10));
}

// 检查ID是否连续
const allIds = db.prepare("SELECT id FROM messages ORDER BY id").all().map(r => r.id);
const gaps = [];
for (let i = 1; i < allIds.length; i++) {
  if (allIds[i] - allIds[i-1] > 1) {
    gaps.push(`${allIds[i-1]} -> ${allIds[i]} (跳过 ${allIds[i] - allIds[i-1] - 1} 个)`);
  }
}
console.log("\nID断层:", gaps.length > 0 ? gaps.slice(0, 5) : "无");

// 显示最近10条
console.log("\n最近10条消息:");
const recent = db.prepare("SELECT id, role, substr(content, 1, 30) as content FROM messages ORDER BY id DESC LIMIT 10").all();
recent.forEach(msg => {
  console.log(`  [${msg.id}] ${msg.role}: ${msg.content}...`);
});

db.close();
console.log("\n检查完成");
