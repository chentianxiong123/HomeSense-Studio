export interface EntityDef {
  entity_id: string
  device_did: string
  domain: string
  capability: string
  name: string
  icon: string
  enabled: boolean
}

export class EntityRegistry {
  private entities = new Map<string, EntityDef>()

  register(entity: EntityDef): void {
    this.entities.set(entity.entity_id, entity)
  }

  get(entityId: string): EntityDef | undefined {
    return this.entities.get(entityId)
  }

  getByDevice(deviceDid: string): EntityDef[] {
    return Array.from(this.entities.values()).filter((e) => e.device_did === deviceDid)
  }

  getAll(): EntityDef[] {
    return Array.from(this.entities.values())
  }

  remove(entityId: string): boolean {
    return this.entities.delete(entityId)
  }
}

export const entityRegistry = new EntityRegistry()
