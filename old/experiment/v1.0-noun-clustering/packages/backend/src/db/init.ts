import { initDb } from './index.js'

async function main() {
  const db = initDb()
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
    .all() as Array<{ name: string }>

  console.log('Database initialized. Tables:')
  for (const t of tables) {
    const count = (db.prepare(`SELECT COUNT(*) as cnt FROM "${t.name}"`).get() as { cnt: number }).cnt
    console.log(`  ${t.name}: ${count} rows`)
  }
}

main().catch(console.error)
