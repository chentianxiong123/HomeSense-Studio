export interface DeviceCapability {
  capability_id?: string
  name: string
  kind: string
  type?: string
  source?: string
  input_schema?: Record<string, unknown>
  output_schema?: Record<string, unknown> | null
  output?: Record<string, { type: string; description: string }> | null
  risk?: string
  metadata?: Record<string, unknown>
}

export interface DeviceIrKey {
  key_id: string
  name: string
  type?: string
}

export interface DeviceExecutionHistoryEntry {
  capability: string
  params: string
  result: string
  time: string
}
