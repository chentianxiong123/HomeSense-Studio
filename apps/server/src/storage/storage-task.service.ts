import { Injectable, NotFoundException } from '@nestjs/common'
import type { AlistCopyInput, AlistDriverMutationResult } from '../alist/alist.types'
import type { StorageTaskRecord } from './storage.types'

@Injectable()
export class StorageTaskService {
  private readonly tasks = new Map<string, StorageTaskRecord>()

  list(): { tasks: StorageTaskRecord[] } {
    return { tasks: Array.from(this.tasks.values()).sort((left, right) => right.created_at.localeCompare(left.created_at)) }
  }

  get(id: string): StorageTaskRecord {
    const task = this.tasks.get(id)
    if (!task) throw new NotFoundException(`Storage task not found: ${id}`)
    return task
  }

  createCopyTask(input: AlistCopyInput, runner: () => Promise<AlistDriverMutationResult>): StorageTaskRecord {
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
    this.tasks.set(task.id, task)
    void this.run(task.id, runner)
    return task
  }

  private async run(id: string, runner: () => Promise<AlistDriverMutationResult>) {
    this.patch(id, { status: 'running', progress: 5, message: 'running' })
    try {
      const result = await runner()
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
    this.tasks.set(id, {
      ...current,
      ...patch,
      updated_at: new Date().toISOString(),
    })
  }
}

function createTaskId(): string {
  return `storage-task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}
