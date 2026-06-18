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

export interface StorageProtocolField {
  key: 'endpoint' | 'username' | 'password' | 'root_path' | 'key_name'
  label: string
  required: boolean
  secret?: boolean
  placeholder?: string
}

export interface StorageProtocolSpec {
  id: string
  name: string
  status: 'implemented' | 'planned'
  summary: string
  default_root_path: string
  readonly_default: boolean
  supports: {
    list: boolean
    get: boolean
    remove: boolean
    copy: boolean
    mkdir: boolean
    upload: boolean
    cross_mount_copy: boolean
  }
  fields: StorageProtocolField[]
}

export interface StorageTaskRecord {
  id: string
  kind: 'copy'
  status: 'queued' | 'running' | 'success' | 'error'
  progress: number
  message?: string
  error?: string
  input: Record<string, unknown>
  result?: Record<string, unknown>
  created_at: string
  updated_at: string
  finished_at?: string
}

export const storageApi = {
  protocols: () =>
    request<{ protocols: StorageProtocolSpec[] }>('/api/storage/protocols'),

  listMounts: () =>
    request<{ mounts: StorageMountRecord[] }>('/api/storage/mounts'),

  deviceFilesEntry: (deviceId: number) =>
    request<{ mount: StorageMountRecord; path: string }>(`/api/storage/devices/${deviceId}/files-entry`),

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

  tasks: () =>
    request<{ tasks: StorageTaskRecord[] }>('/api/storage/tasks'),

  task: (id: string) =>
    request<{ task: StorageTaskRecord }>(`/api/storage/tasks/${encodeURIComponent(id)}`),

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

  copyTask: (srcDir: string, dstDir: string, names: string[]) =>
    request<{ task: StorageTaskRecord }>('/api/storage/fs/copy-task', {
      method: 'POST',
      body: JSON.stringify({ src_dir: srcDir, dst_dir: dstDir, names }),
    }),

  mkdir: (path: string) =>
    request<{ created: number }>('/api/storage/fs/mkdir', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  downloadUrl: (path: string) =>
    `/api/storage/fs/download?path=${encodeURIComponent(path)}`,

  upload: (path: string, file: File) =>
    request<{ uploaded: number }>(`/api/storage/fs/upload?path=${encodeURIComponent(path)}`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': file.type || 'application/octet-stream' },
    }),
}
