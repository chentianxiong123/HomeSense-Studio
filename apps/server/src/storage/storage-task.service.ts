import { Injectable, NotFoundException } from '@nestjs/common'
import type { AlistCopyInput, AlistDriverMutationResult } from '../alist/alist.types'
import { getDb } from '../db/database'
import type { StorageTaskRecord } from './storage.types'

type TaskProgressReporter = (patch: { progress?: number; message?: string }) => void

@Injectable()
export class StorageTaskService {
  constructor() {
    this.markInterruptedTasks()
  }

  list(): { tasks: StorageTaskRecord[] } {
    const rows = getDb()
      .prepare(
        `SELECT id, kind, status, progress, message, error, input_json, result_json, created_at, updated_at, finished_at
         FROM storage_tasks
         ORDER BY created_at DESC
         LIMIT 100`,
      )
      .all() as StorageTaskRow[]
    return { tasks: rows.map(toTaskRecord) }
  }

  get(id: string): StorageTaskRecord {
    const row = getDb()
      .prepare(
        `SELECT id, kind, status, progress, message, error, input_json, result_json, created_at, updated_at, finished_at
         FROM storage_tasks
         WHERE id = ?`,
      )
      .get(id) as StorageTaskRow | undefined
    if (!row) throw new NotFoundException(`Storage task not found: ${id}`)
    return toTaskRecord(row)
  }

  createCopyTask(input: AlistCopyInput, runner: (report: TaskProgressReporter) => Promise<AlistDriverMutationResult>): StorageTaskRecord {
    const now = new Date().toISOString()
    const task: StorageTaskRecord = {
      id: createTaskId(),
      kind: 'copy',
      status: 'queued',
      progress: 0,
      message: 'queued',
      input: { ...input },
      created_at: now,
      updated_at: now,
    }
    getDb()
      .prepare(
        `INSERT INTO storage_tasks (id, kind, status, progress, message, input_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(task.id, task.kind, task.status, task.progress, task.message ?? null, JSON.stringify(task.input), task.created_at, task.updated_at)
    void this.run(task.id, runner)
    return task
  }

  private async run(id: string, runner: (report: TaskProgressReporter) => Promise<AlistDriverMutationResult>) {
    this.patch(id, { status: 'running', progress: 5, message: 'running' })
    try {
      const result = await runner((patch) => {
        this.patch(id, {
          progress: clampProgress(patch.progress ?? 5),
          message: patch.message ?? 'running',
        })
      })
      this.patch(id, {
        status: 'success',
        progress: 100,
        message: 'finished',
        result: result as Record<string, unknown>,
        finished_at: new Date().toISOString(),
      })
    } catch (error) {
      this.patch(id, {
        status: 'error',
        progress: 100,
        error: error instanceof Error ? error.message : String(error),
        finished_at: new Date().toISOString(),
      })
    }
  }

  private patch(id: string, patch: Partial<StorageTaskRecord>) {
    const current = this.get(id)
    const next: StorageTaskRecord = {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    }
    getDb()
      .prepare(
        `UPDATE storage_tasks
         SET status = ?, progress = ?, message = ?, error = ?, input_json = ?, result_json = ?, updated_at = ?, finished_at = ?
         WHERE id = ?`,
      )
      .run(
        next.status,
        next.progress,
        next.message ?? null,
        next.error ?? null,
        JSON.stringify(next.input ?? {}),
        next.result ? JSON.stringify(next.result) : null,
        next.updated_at,
        next.finished_at ?? null,
        id,
      )
  }

  private markInterruptedTasks() {
    const now = new Date().toISOString()
    getDb()
      .prepare(
        `UPDATE storage_tasks
         SET status = 'error',
             progress = 100,
             error = 'server restarted before task finished',
             message = NULL,
             updated_at = ?,
             finished_at = ?
         WHERE status IN ('queued', 'running')`,
      )
      .run(now, now)
  }
}

interface StorageTaskRow {
  id: string
  kind: string
  status: string
  progress: number
  message: string | null
  error: string | null
  input_json: string
  result_json: string | null
  created_at: string
  updated_at: string
  finished_at: string | null
}

function toTaskRecord(row: StorageTaskRow): StorageTaskRecord {
  return {
    id: row.id,
    kind: 'copy',
    status: toTaskStatus(row.status),
    progress: Number(row.progress ?? 0),
    message: row.message ?? undefined,
    error: row.error ?? undefined,
    input: parseRecord(row.input_json),
    result: row.result_json ? parseRecord(row.result_json) : undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    finished_at: row.finished_at ?? undefined,
  }
}

function toTaskStatus(value: string): StorageTaskRecord['status'] {
  if (value === 'queued' || value === 'running' || value === 'success' || value === 'error') return value
  return 'error'
}

function parseRecord(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function createTaskId(): string {
  return `storage-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 5
  return Math.max(0, Math.min(99, Math.round(value)))
}
