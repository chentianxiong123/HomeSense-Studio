export interface AlistDriverMount {
  path: string
  driver: string
  label?: string
  auth_ref?: string | number
  authorization_id?: number
  root_path?: string
  address?: string
  username?: string
  password?: string
  credentials?: string
  readonly?: boolean
}

export interface AlistDriverProps {
  config_file?: string
  mounts?: AlistDriverMount[]
}

export interface AlistDriverConfig {
  mounts: AlistDriverMount[]
}

export interface AlistDriverEntry {
  name: string
  path: string
  size: number
  is_dir: boolean
  modified?: string
  driver: string
  mount_path: string
}

export interface AlistDriverListResult {
  path: string
  provider: string
  mount_path?: string
  entries: AlistDriverEntry[]
  total: number
}

export interface AlistDriverGetResult extends AlistDriverEntry {
  raw_url?: string
}

export interface AlistDriverHealthResult {
  status: string
  version: string
  drivers: string[]
  mounts: string[]
  started_at: string
}

export interface AlistDriverMutationResult {
  copied?: number
  removed?: number
}

export interface AlistListInput {
  path?: string
  page?: number
  per_page?: number
  refresh?: boolean
}

export interface AlistGetInput {
  path?: string
}

export interface AlistRemoveInput {
  dir?: string
  names?: string[]
}

export interface AlistCopyInput {
  src_dir?: string
  dst_dir?: string
  names?: string[]
  overwrite?: boolean
}

export interface AlistDriverRawResult {
  code: number
  data?: unknown
  error?: string
  message?: string
  retryable?: boolean
  duration_ms: number
}

export interface AlistAuthorizationRecord {
  id: number
  name: string
  driver: string
  endpoint: string
  username?: string
  props: Record<string, unknown>
  has_secret: boolean
  created_at: string
  updated_at: string
}

export interface AlistAuthorizationPrivateRecord extends AlistAuthorizationRecord {
  secret: Record<string, unknown>
}

export interface CreateAlistAuthorizationInput {
  name?: string
  driver?: string
  endpoint?: string
  username?: string
  password?: string
  secret?: Record<string, unknown>
  props?: Record<string, unknown>
}

export interface UpdateAlistAuthorizationInput {
  name?: string
  driver?: string
  endpoint?: string
  username?: string
  password?: string
  secret?: Record<string, unknown>
  props?: Record<string, unknown>
}
