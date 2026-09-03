import { describe, expect, it } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import { ContextCompleterService } from './context-completer.js'

describe('ContextCompleterService', () => {
  it('does not rewrite workflow-oriented bilibili queries into TV watch commands', () => {
    const db = createInMemoryDb()
    const service = new ContextCompleterService(() => db)

    const result = service.complete({
      message: 'run the bilibili workflow',
      history: [],
      working_context: { current_device: '1', current_device_name: '客厅电视', current_device_type: 'television' },
    })

    expect(result.completed_message).toBe('run the bilibili workflow')
  })

  it('uses the active context device for action-oriented bilibili queries', () => {
    const db = createInMemoryDb()
    const service = new ContextCompleterService(() => db)

    const result = service.complete({
      message: 'watch bilibili on tv',
      history: [],
      working_context: { current_device: '7', current_device_name: '客厅电视', current_device_type: 'television' },
    })

    expect(result.completed_message).toMatch(/客厅电视/)
    expect(result.completed_message).toMatch(/B站/)
    expect(result.target_device_id).toBe('7')
  })

  it('uses real user devices instead of hard-coded historical device ids', () => {
    const db = createInMemoryDb()
    const roomId = Number(db.prepare('INSERT INTO rooms (name) VALUES (?)').run('客厅').lastInsertRowid)
    const deviceId = Number(
      db.prepare('INSERT INTO user_devices (name, device_type, room_id) VALUES (?, ?, ?)')
        .run('客厅投影', 'television', roomId).lastInsertRowid,
    )
    const service = new ContextCompleterService(() => db)

    const result = service.complete({
      message: '打开客厅投影看 B 站',
      history: [],
      working_context: {},
    })

    expect(result.target_device_id).toBe(String(deviceId))
    expect(result.target_device_label).toBe('客厅投影')
    expect(result.completed_message).toBe('打开客厅投影看 B 站')
  })

  it('does not fabricate a TV target when no real or active device exists', () => {
    const db = createInMemoryDb()
    const service = new ContextCompleterService(() => db)

    const result = service.complete({
      message: 'watch bilibili on tv',
      history: [],
      working_context: {},
    })

    expect(result.target_device_id).toBeUndefined()
    expect(result.completed_message).toBe('watch bilibili on tv')
  })
})

