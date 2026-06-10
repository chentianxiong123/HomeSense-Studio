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

export interface CreateStorageMountInput {
  name?: string
  virtual_path?: string
  driver?: string
  authorization_id?: number
  readonly?: boolean
  props?: Record<string, unknown>
}

export interface UpdateStorageMountInput {
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
    upload: boolean
    cross_mount_copy: boolean
  }
  fields: StorageProtocolField[]
}

export type StorageTaskStatus = 'queued' | 'running' | 'success' | 'error'

export interface StorageTaskRecord {
  id: string
  kind: 'copy'
  status: StorageTaskStatus
  progress: number
  message?: string
  error?: string
  input: Record<string, unknown>
  result?: Record<string, unknown>
  created_at: string
  updated_at: string
  finished_at?: string
}
