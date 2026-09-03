export type VariableValueMode = 'static' | 'simulated' | 'unresolved'

export class VariablePool {
  private readonly store = new Map<string, unknown>()
  private readonly metadata = new Map<string, VariableValueMode>()

  constructor(private readonly parent?: VariablePool) {}

  createChildScope(): VariablePool {
    return new VariablePool(this)
  }

  get(key: string): unknown {
    const pathValue = this.getByPath(key)
    if (pathValue !== undefined) {
      return pathValue
    }

    return this.parent?.get(key)
  }

  set(key: string, value: unknown, mode?: VariableValueMode): void {
    this.store.set(key, value)
    if (mode) {
      this.metadata.set(key, mode)
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined
  }

  getMeta(key: string): VariableValueMode | undefined {
    const direct = this.getMetaByPath(key)
    if (direct !== undefined) return direct
    return this.parent?.getMeta(key)
  }

  resolve(template: string): string {
    return template.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (match, path) => {
      const value = this.get(path)
      if (value === undefined) return match
      if (typeof value === 'string') return value
      if (typeof value === 'number' || typeof value === 'boolean') return String(value)
      return JSON.stringify(value)
    })
  }

  clear(): void {
    this.store.clear()
    this.metadata.clear()
  }

  toJSON(): Record<string, unknown> {
    const obj: Record<string, unknown> = this.parent?.toJSON() ?? {}
    for (const [key, value] of this.store) {
      obj[key] = value
    }
    return obj
  }

  private getByPath(path: string): unknown {
    if (this.store.has(path)) {
      return this.store.get(path)
    }

    const parts = path.split('.')
    for (let prefixLength = parts.length - 1; prefixLength > 0; prefixLength -= 1) {
      const prefix = parts.slice(0, prefixLength).join('.')
      if (!this.store.has(prefix)) continue

      let current: unknown = this.store.get(prefix)
      for (let i = prefixLength; i < parts.length; i++) {
        if (current == null || (typeof current !== 'object' && typeof current !== 'function')) {
          current = undefined
          break
        }
        current = (current as Record<string, unknown>)[parts[i]]
      }
      if (current !== undefined) {
        return current
      }
    }

    let current: unknown = this.store.get(parts[0])
    for (let i = 1; i < parts.length; i++) {
      if (current == null || typeof current !== 'object') return undefined
      current = (current as Record<string, unknown>)[parts[i]]
    }
    return current
  }

  private getMetaByPath(path: string): VariableValueMode | undefined {
    if (this.metadata.has(path)) {
      return this.metadata.get(path)
    }

    const parts = path.split('.')
    for (let prefixLength = parts.length - 1; prefixLength > 0; prefixLength -= 1) {
      const prefix = parts.slice(0, prefixLength).join('.')
      if (!this.metadata.has(prefix)) continue
      return this.metadata.get(prefix)
    }

    return undefined
  }
}
