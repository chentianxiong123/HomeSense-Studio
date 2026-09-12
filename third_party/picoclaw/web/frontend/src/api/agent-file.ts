import { launcherFetch } from "@/api/http"
import { getCurrentUserId } from "./user-config"

export interface AgentFile {
  path: string
  content: string
  size?: number
  mod_time?: string
  exists: boolean
}

export async function readAgentFile(path: string): Promise<AgentFile> {
  const uid = await getCurrentUserId()
  const res = await launcherFetch(`/api/v1/users/${uid}/agent-file?path=${encodeURIComponent(path)}`)
  if (!res.ok) throw new Error(`GET agent-file ${res.status}`)
  return res.json()
}

export async function writeAgentFile(path: string, content: string): Promise<void> {
  const uid = await getCurrentUserId()
  const res = await launcherFetch(`/api/v1/users/${uid}/agent-file`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, content }),
  })
  if (!res.ok) throw new Error(`PUT agent-file ${res.status}`)
}
