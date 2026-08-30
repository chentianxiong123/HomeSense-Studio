export interface Device {
  did: string
  model: string
  name: string
  manufacturer: string
  connection_type: 'wifi' | 'bt' | 'ir' | 'gateway'
  parent_id: string | null
  spec_json: string
  last_seen: string
}

export interface Entity {
  entity_id: string
  device_did: string
  domain: string
  capability: string
  name: string
  icon: string
  enabled: boolean
}

export interface EntityState {
  entity_id: string
  state: string
  attributes_json: string
  last_updated: string
}
