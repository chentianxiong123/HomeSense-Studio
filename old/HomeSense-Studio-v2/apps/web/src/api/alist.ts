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

export interface AlistDriverMount {
  path: string
  driver: string
  label?: string
  auth_ref?: string | number
  authorization_id?: number
  root_path?: string
  address?: string
  username?: string
  readonly?: boolean
}

export interface AlistDriverProps {
  config_file?: string
  mounts?: AlistDriverMount[]
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

export interface AlistAuthorizationInput {
  name?: string
  driver?: string
  endpoint?: string
  username?: string
  password?: string
  secret?: Record<string, unknown>
  props?: Record<string, unknown>
}

export const alistApi = {
  listAuthorizations: () =>
    request<{ authorizations: AlistAuthorizationRecord[] }>('/api/alist/authorizations'),

  createAuthorization: (body: AlistAuthorizationInput) =>
    request<{ authorization: AlistAuthorizationRecord }>('/api/alist/authorizations', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateAuthorization: (id: number, body: AlistAuthorizationInput) =>
    request<{ authorization: AlistAuthorizationRecord }>(`/api/alist/authorizations/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  removeAuthorization: (id: number) =>
    request<{ status: 'deleted'; id: number }>(`/api/alist/authorizations/${id}`, {
      method: 'DELETE',
    }),

  health: (deviceId: number) =>
    request<AlistDriverHealthResult>(`/api/alist/devices/${deviceId}/health`),

  list: (deviceId: number, path: string) =>
    request<AlistDriverListResult>(`/api/alist/devices/${deviceId}/fs/list`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  get: (deviceId: number, path: string) =>
    request<AlistDriverGetResult>(`/api/alist/devices/${deviceId}/fs/get`, {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  remove: (deviceId: number, dir: string, names: string[]) =>
    request<AlistDriverMutationResult>(`/api/alist/devices/${deviceId}/fs/remove`, {
      method: 'POST',
      body: JSON.stringify({ dir, names }),
    }),

  copy: (deviceId: number, srcDir: string, dstDir: string, names: string[]) =>
    request<AlistDriverMutationResult>(`/api/alist/devices/${deviceId}/fs/copy`, {
      method: 'POST',
      body: JSON.stringify({ src_dir: srcDir, dst_dir: dstDir, names }),
    }),
}
