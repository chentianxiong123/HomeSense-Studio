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
