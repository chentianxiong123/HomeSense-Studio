import { launcherFetch } from "@/api/http"
import { getCurrentUserId } from "./user-config"

export interface DailyNote {
  date: string
  content: string
  size: number
  mod_time: string
}

export interface MemoryFile {
  path: string
  content: string
  size: number
  mod_time: string
}

export async function listMemoryNotes(): Promise<{ notes: DailyNote[]; total: number }> {
  const uid = await getCurrentUserId()
  const res = await launcherFetch(`/api/v1/users/${uid}/memory/notes`)
  if (!res.ok) throw new Error(`GET memory-notes ${res.status}`)
  return res.json()
}

export async function readMemoryNote(date: string): Promise<DailyNote> {
  const uid = await getCurrentUserId()
  const res = await launcherFetch(`/api/v1/users/${uid}/memory/notes?date=${encodeURIComponent(date)}`)
  if (!res.ok) throw new Error(`GET memory-note ${res.status}`)
  return res.json()
}

export async function readMemoryFile(path: string): Promise<MemoryFile> {
  const uid = await getCurrentUserId()
  const res = await launcherFetch(`/api/v1/users/${uid}/memory/files?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`GET memory-file ${res.status}`)
  return res.json()
}
