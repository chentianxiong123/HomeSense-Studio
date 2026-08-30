import { createInMemoryDb } from '../db/index.js'

export { createInMemoryDb }

export function createDbProvider(): () => ReturnType<typeof createInMemoryDb> {
  const db = createInMemoryDb()
  return () => db
}
