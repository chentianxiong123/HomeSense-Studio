import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DATA_DIR = path.resolve(__dirname, '..', '..', '..', 'data')
const CONNECTIONS_FILE = path.join(DATA_DIR, 'adb-connections.json')

export interface AdbConnectionRecord {
  address: string
  name: string
  model: string
  first_seen: string
  last_seen: string
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true })
  }
}

function loadFromDisk(): AdbConnectionRecord[] {
  if (!fs.existsSync(CONNECTIONS_FILE)) return []
  try {
    return JSON.parse(fs.readFileSync(CONNECTIONS_FILE, 'utf-8')) as AdbConnectionRecord[]
  } catch {
    return []
  }
}

function saveToDisk(records: AdbConnectionRecord[]) {
  ensureDataDir()
  fs.writeFileSync(CONNECTIONS_FILE, JSON.stringify(records, null, 2), 'utf-8')
}

export function loadAdbConnections(): AdbConnectionRecord[] {
  return loadFromDisk()
}

export function saveAdbConnections(records: AdbConnectionRecord[]) {
  saveToDisk(records)
}

export function upsertAdbConnection(record: AdbConnectionRecord) {
  const records = loadFromDisk()
  const idx = records.findIndex(r => r.address === record.address)
  const updated: AdbConnectionRecord = {
    ...record,
    first_seen: idx >= 0 ? records[idx].first_seen : record.first_seen,
    last_seen: new Date().toISOString(),
  }
  if (idx >= 0) {
    records[idx] = updated
  } else {
    records.push(updated)
  }
  saveToDisk(records)
}

export function removeAdbConnection(address: string) {
  const records = loadFromDisk().filter(r => r.address !== address)
  saveToDisk(records)
}