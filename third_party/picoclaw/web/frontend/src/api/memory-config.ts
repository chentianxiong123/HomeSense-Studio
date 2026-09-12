/**
 * HomeSense v7 — Memory configuration API.
 *
 * Per-tenant memory.json controls:
 *   - long-term memory (MEMORY.md) enable/disable
 *   - daily notes enable/disable + retention days
 *   - history search enable/disable + max results
 */

import { launcherFetch } from "@/api/http"
import { getCurrentUserId } from "./user-config"

export interface DailyNotesConfig {
  enabled: boolean
  retention_days: number
}

export interface HistorySearchConfig {
  enabled: boolean
  max_results: number
}

export interface MemoryConfig {
  enabled: boolean
  daily_notes: DailyNotesConfig
  history_search: HistorySearchConfig
}

export const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  enabled: true,
  daily_notes: { enabled: true, retention_days: 3 },
  history_search: { enabled: true, max_results: 8 },
}

export async function getMemoryConfig(): Promise<MemoryConfig> {
  const uid = await getCurrentUserId()
  const res = await launcherFetch(`/api/v1/users/${uid}/memory-config`)
  if (!res.ok) throw new Error(`GET memory-config ${res.status}`)
  return res.json()
}

export async function saveMemoryConfig(cfg: MemoryConfig): Promise<void> {
  const uid = await getCurrentUserId()
  const res = await launcherFetch(`/api/v1/users/${uid}/memory-config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cfg),
  })
  if (!res.ok) throw new Error(`PUT memory-config ${res.status}`)
}
