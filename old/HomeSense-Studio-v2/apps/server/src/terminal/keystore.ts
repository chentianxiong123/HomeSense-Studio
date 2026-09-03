import * as fs from 'fs'
import * as path from 'path'

// Resolve runtime-keys relative to this file's compiled location, not cwd.
// dist/terminal/keystore.js → walk up to apps/server/, then runtime-keys/
// src/terminal/keystore.ts → same path after build.
const HERE = __dirname
const ROOT = (() => {
  // dist lives at apps/server/dist/terminal/ — go up two levels
  // src  lives at apps/server/src/terminal/  — go up two levels
  return path.resolve(HERE, '..', '..', 'runtime-keys')
})()

const DIRS = {
  ssh: path.join(ROOT, 'ssh'),
  adb: path.join(ROOT, 'adb'),
} as const

export type KeyKind = 'ssh' | 'adb'

function ensureDir(p: string) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
}

function list(kind: KeyKind): string[] {
  const dir = DIRS[kind]
  ensureDir(dir)
  return fs.readdirSync(dir)
    .filter((f) => !f.endsWith('.gitkeep') && !f.endsWith('.pub'))
    .sort()
}

function read(kind: KeyKind, name: string): string {
  // path traversal guard
  const file = path.join(DIRS[kind], name)
  const normalized = path.resolve(file)
  if (!normalized.startsWith(path.resolve(DIRS[kind]))) {
    throw new Error(`invalid key name: ${name}`)
  }
  if (!fs.existsSync(normalized)) {
    throw new Error(`${kind} key not found: ${name}`)
  }
  return fs.readFileSync(normalized, 'utf-8')
}

export const KeyStore = {
  listSshKeys: () => list('ssh'),
  readSshKey: (name: string) => read('ssh', name),
  listAdbKeys: () => list('adb'),
  readAdbKey: (name: string) => read('adb', name),
}
