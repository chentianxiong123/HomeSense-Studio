/**
 * Port: Memory
 *
 * Boundary between the system and the memory layer.
 * The memory layer itself owns FTS, graph, embeddings, compiled knowledge,
 * experience paths. Callers see only this surface.
 */

export type MemoryKind = 'fact' | 'preference' | 'event' | 'note' | 'experience_path' | 'legacy_experience_note'

export interface MemoryItem {
  id?: number
  kind: MemoryKind
  body: string
  scope?: string
  priority?: number
  source?: string
  tags?: string[]
  ttl_seconds?: number
  metadata?: Record<string, unknown>
}

export interface MemoryHit {
  item: MemoryItem
  score: number
  source: 'lexical' | 'semantic' | 'graph' | 'exact'
}

export interface MemorySearchRequest {
  query: string
  top_k?: number
  kinds?: MemoryKind[]
  scope?: string
  include_graph?: boolean
  recency_seconds?: number
}

export interface MemoryPort {
  upsert(item: MemoryItem): Promise<MemoryItem>
  get(id: number): Promise<MemoryItem | undefined>
  search(req: MemorySearchRequest): Promise<MemoryHit[]>
  forget(id: number): Promise<void>
}
