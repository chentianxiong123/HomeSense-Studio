import { Injectable } from '@nestjs/common'

export interface SettingRecord {
  key: string
  value: unknown
}

@Injectable()
export class SettingService {
  private store = new Map<string, unknown>()

  list(): SettingRecord[] {
    return Array.from(this.store.entries()).map(([key, value]) => ({ key, value }))
  }

  get(key: string): SettingRecord | undefined {
    if (!this.store.has(key)) return undefined
    return { key, value: this.store.get(key) }
  }

  set(key: string, value: unknown): SettingRecord {
    this.store.set(key, value)
    return { key, value }
  }

  delete(key: string): boolean {
    return this.store.delete(key)
  }
}
