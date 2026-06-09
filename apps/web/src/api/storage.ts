import type {
  AlistDriverEntry,
  AlistDriverGetResult,
  AlistDriverHealthResult,
  AlistDriverListResult,
  AlistDriverMutationResult,
} from './alist'

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const hasBody = options?.body != null
  const response = await fetch(path, {
    ...options,
    headers: {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...(options?.headers ?? {}),
    },
  })
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`
    try {
      const body = await response.json() as { message?: string; error?: string }
      message = body.message || body.error || message
    } catch {}
    throw new Error(message)
  }
  return await response.json() as T
}

export type StorageFileEntry = AlistDriverEntry

export interface StorageMountRecord {
  id: number
  name: string
  virtual_path: string
  driver: string
  authorization_id: number
  readonly: boolean
  props: Record<string, unknown>
  created_at: string
  updated_at: string
}

export interface StorageMountInput {
  name?: string
  virtual_path?: string
  driver?: string
  authorization_id?: number
  readonly?: boolean
  props?: Record<string, unknown>
}

export const storageApi = {
  listMounts: () =>
    request<{ mounts: StorageMountRecord[] }>('/api/storage/mounts'),

  createMount: (body: StorageMountInput) =>
    request<{ mount: StorageMountRecord }>('/api/storage/mounts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateMount: (id: number, body: StorageMountInput) =>
    request<{ mount: StorageMountRecord }>(`/api/storage/mounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  removeMount: (id: number) =>
    request<{ status: 'deleted'; id: number }>(`/api/storage/mounts/${id}`, {
      method: 'DELETE',
    }),

  health: () =>
    request<AlistDriverHealthResult>('/api/storage/health'),

  list: (path: string) =>
    request<AlistDriverListResult>('/api/storage/fs/list', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  get: (path: string) =>
    request<AlistDriverGetResult>('/api/storage/fs/get', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  remove: (dir: string, names: string[]) =>
    request<AlistDriverMutationResult>('/api/storage/fs/remove', {
      method: 'POST',
      body: JSON.stringify({ dir, names }),
    }),

  copy: (srcDir: string, dstDir: string, names: string[]) =>
    request<AlistDriverMutationResult>('/api/storage/fs/copy', {
      method: 'POST',
      body: JSON.stringify({ src_dir: srcDir, dst_dir: dstDir, names }),
    }),
}
