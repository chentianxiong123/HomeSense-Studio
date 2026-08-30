import { describe, expect, it } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import {
  buildRuntimeContextWindow,
  getActiveContextValue,
  getRuntimeContextState,
  getRuntimeContextSettings,
  saveRuntimeContextSettings,
} from './index.js'
import { MemoryAssetsService } from '../memory-assets/index.js'

describe('runtime context window', () => {
  it('enriches the active device context with device and room metadata', () => {
    const db = createInMemoryDb()
    const roomId = Number(db.prepare('INSERT INTO rooms (name) VALUES (?)').run('客厅').lastInsertRowid)
    const deviceId = Number(
      db.prepare('INSERT INTO user_devices (name, device_type, room_id) VALUES (?, ?, ?)')
        .run('客厅电视', 'television', roomId).lastInsertRowid,
    )
    db.prepare("INSERT INTO user_context (key, value, updated_at) VALUES ('current_device', ?, ?)")
      .run(String(deviceId), new Date().toISOString())

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [{ role: 'user', content: '你好' }],
      getDb: () => db,
    })

    expect(getActiveContextValue(context, 'current_device')).toBe(String(deviceId))
    expect(context.working_context).toMatchObject({
      current_device: String(deviceId),
      current_device_id: deviceId,
      current_device_name: '客厅电视',
      current_device_type: 'television',
      current_device_room_id: roomId,
      current_device_room_name: '客厅',
      current_room: String(roomId),
      current_room_id: roomId,
      current_room_name: '客厅',
    })
  })

  it('keeps selected device context active while the conversation is active', () => {
    const db = createInMemoryDb()
    const deviceId = Number(
      db.prepare('INSERT INTO user_devices (name, device_type) VALUES (?, ?)')
        .run('卧室音箱', 'speaker').lastInsertRowid,
    )
    db.prepare("INSERT INTO user_context (key, value, updated_at) VALUES ('current_device', ?, ?)")
      .run(String(deviceId), new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString())

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [{ role: 'user', content: '打开' }],
      ttlMs: 30 * 60 * 1000,
      getDb: () => db,
    })

    expect(context.session_active).toBe(true)
    expect(context.entries.current_device.active).toBe(true)
    expect(getActiveContextValue(context, 'current_device')).toBe(String(deviceId))
    expect(context.working_context.current_device_name).toBe('卧室音箱')
  })

  it('expires selected context after the conversation has been idle for the TTL', () => {
    const db = createInMemoryDb()
    const deviceId = Number(
      db.prepare('INSERT INTO user_devices (name, device_type) VALUES (?, ?)')
        .run('卧室音箱', 'speaker').lastInsertRowid,
    )
    db.prepare("INSERT INTO user_context (key, value, updated_at) VALUES ('current_device', ?, ?)")
      .run(String(deviceId), new Date().toISOString())

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [],
      lastActivityAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      ttlMs: 30 * 60 * 1000,
      getDb: () => db,
    })

    expect(context.session_active).toBe(false)
    expect(context.entries.current_device.active).toBe(false)
    expect(getActiveContextValue(context, 'current_device')).toBeUndefined()
    expect(context.working_context.current_device).toBeUndefined()
  })

  it('does not reactivate expired context just because a new message arrived', () => {
    const db = createInMemoryDb()
    const deviceId = Number(
      db.prepare('INSERT INTO user_devices (name, device_type) VALUES (?, ?)')
        .run('客厅电视', 'television').lastInsertRowid,
    )
    db.prepare("INSERT INTO user_context (key, value, updated_at) VALUES ('current_device', ?, ?)")
      .run(String(deviceId), new Date().toISOString())

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [{ role: 'user', content: '打开电视' }],
      lastActivityAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      ttlMs: 30 * 60 * 1000,
      getDb: () => db,
    })

    expect(context.session_active).toBe(false)
    expect(context.entries.current_device.active).toBe(false)
    expect(context.working_context.current_device_name).toBeUndefined()
  })

  it('keeps expired device context inactive until the user selects it again', () => {
    const db = createInMemoryDb()
    const deviceId = Number(
      db.prepare('INSERT INTO user_devices (name, device_type) VALUES (?, ?)')
        .run('客厅电视', 'television').lastInsertRowid,
    )
    const selectedAt = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString()
    const idleAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    db.prepare("INSERT INTO user_context (key, value, updated_at) VALUES ('current_device', ?, ?)")
      .run(String(deviceId), selectedAt)

    const expired = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [{ role: 'user', content: '你好' }],
      lastActivityAt: idleAt,
      ttlMs: 30 * 60 * 1000,
      getDb: () => db,
    })

    expect(expired.session_active).toBe(false)
    expect(expired.entries.current_device.active).toBe(false)
    expect(getRuntimeContextState(db).expired_at).toBe(idleAt)

    const freshTurn = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '我在。' },
        { role: 'user', content: '返回' },
      ],
      lastActivityAt: new Date().toISOString(),
      ttlMs: 30 * 60 * 1000,
      getDb: () => db,
    })

    expect(freshTurn.session_active).toBe(true)
    expect(freshTurn.entries.current_device.active).toBe(false)
    expect(freshTurn.working_context.current_device_name).toBeUndefined()

    db.prepare("UPDATE user_context SET updated_at = ? WHERE key = 'current_device'")
      .run(new Date().toISOString())
    const reselected = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [{ role: 'user', content: '返回' }],
      lastActivityAt: new Date().toISOString(),
      ttlMs: 30 * 60 * 1000,
      getDb: () => db,
    })

    expect(reselected.entries.current_device.active).toBe(true)
    expect(reselected.working_context.current_device_name).toBe('客厅电视')
  })

  it('drops stale chat history after TTL and keeps only the fresh user turn', () => {
    const db = createInMemoryDb()

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [
        { role: 'user', content: '之前让我写小作文' },
        { role: 'assistant', content: '春日的午后，阳光懒洋洋地洒在窗台上。' },
        { role: 'user', content: '你好' },
      ],
      lastActivityAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
      ttlMs: 30 * 60 * 1000,
      getDb: () => db,
    })

    expect(context.session_active).toBe(false)
    expect(context.recent_messages).toEqual([{ role: 'user', content: '你好' }])
    expect(context.context_usage.message_tokens).toBeLessThan(20)
  })

  it('treats legacy SQLite UTC timestamps as active when they are fresh', () => {
    const db = createInMemoryDb()
    const deviceId = Number(
      db.prepare('INSERT INTO user_devices (name, device_type) VALUES (?, ?)')
        .run('书房电脑', 'computer').lastInsertRowid,
    )
    db.prepare("INSERT INTO user_context (key, value, updated_at) VALUES ('current_device', ?, datetime('now'))")
      .run(String(deviceId))

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [{ role: 'user', content: '打开电脑' }],
      getDb: () => db,
    })

    expect(context.entries.current_device.active).toBe(true)
    expect(context.working_context.current_device_id).toBe(deviceId)
    expect(context.working_context.current_device_name).toBe('书房电脑')
  })

  it('loads and clamps runtime context settings from the settings table', () => {
    const db = createInMemoryDb()
    const saved = saveRuntimeContextSettings({
      max_turns: 24,
      ttl_ms: 45 * 60 * 1000,
      retrieval_limit: 5,
      context_token_budget: 32_000,
    }, db)

    expect(saved).toMatchObject({
      max_turns: 24,
      ttl_ms: 45 * 60 * 1000,
      retrieval_limit: 5,
      context_token_budget: 32_000,
    })
    expect(getRuntimeContextSettings(db)).toEqual(saved)
  })

  it('reports approximate context token usage', () => {
    const db = createInMemoryDb()
    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '我在。' },
      ],
      contextTokenBudget: 20_000,
      getDb: () => db,
    })

    expect(context.context_usage.max_tokens).toBe(20_000)
    expect(context.context_usage.used_tokens).toBeGreaterThan(0)
  })

  it('recalls saved experience paths as lightweight runtime context', () => {
    const db = createInMemoryDb()
    const memoryAssets = new MemoryAssetsService(() => db)
    memoryAssets.recordExperiencePath({
      id: 'memory.experience_path.runtime.watch_bilibili',
      title: '客厅电视打开 B 站',
      summary: '在客厅电视上打开 B 站',
      intent_pattern: '打开客厅电视 B 站',
      steps: [
        {
          tool: 'device_agent',
          action: 'execute_device_capability',
          params: {
            device_id: 2,
            capability_id: 'adb.launch_app',
            arguments: { package: 'tv.danmaku.bili' },
          },
        },
      ],
      skill_refs: [{ kind: 'device_skill', id: 'device_skill.tv_box', label: 'tv_box' }],
      device_refs: ['device:2'],
      source: 'runtime',
    })

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [{ role: 'user', content: '我要看 B 站' }],
      retrievalLimit: 3,
      getDb: () => db,
    })

    expect(context.retrieval_hits[0]).toMatchObject({
      id: 'memory.experience_path.runtime.watch_bilibili',
      kind: 'experience_path',
      title: '客厅电视打开 B 站',
      source: 'memory',
      device_refs: ['device:2'],
      success_count: 1,
    })
    expect(context.retrieval_hits[0].steps?.[0]).toMatchObject({
      tool: 'device_agent',
      action: 'execute_device_capability',
    })
  })

  it('skips lightweight retrieval for pure greetings', () => {
    const db = createInMemoryDb()
    const memoryAssets = new MemoryAssetsService(() => db)
    memoryAssets.recordExperiencePath({
      id: 'memory.experience_path.runtime.say_hello',
      title: '你好路径',
      summary: '一条会被误召回的问候路径',
      intent_pattern: '你好',
      steps: [
        {
          tool: 'service',
          action: 'say_hello',
          params: { message: '你好' },
        },
      ],
      source: 'runtime',
    })

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [{ role: 'user', content: '你好' }],
      retrievalLimit: 3,
      getDb: () => db,
    })

    expect(context.retrieval_hits).toEqual([])
    expect(context.context_usage.retrieval_tokens).toBe(0)
  })

  it('skips lightweight retrieval for common casual variants', () => {
    const db = createInMemoryDb()
    const memoryAssets = new MemoryAssetsService(() => db)
    memoryAssets.recordExperiencePath({
      id: 'memory.experience_path.runtime.casual',
      title: '寒暄路径',
      summary: '会被寒暄召回的路径',
      intent_pattern: '谢谢',
      steps: [
        {
          tool: 'service',
          action: 'say_thanks',
          params: { message: '谢谢' },
        },
      ],
      source: 'runtime',
    })

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [
        { role: 'user', content: 'hello there' },
      ],
      retrievalLimit: 3,
      getDb: () => db,
    })

    expect(context.retrieval_hits).toEqual([])

    const followUp = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [
        { role: 'user', content: '谢谢' },
      ],
      retrievalLimit: 3,
      getDb: () => db,
    })

    expect(followUp.retrieval_hits).toEqual([])
  })

  it('skips stale workflow experience paths in lightweight runtime context', () => {
    const db = createInMemoryDb()
    const memoryAssets = new MemoryAssetsService(() => db)
    db.prepare(`
      INSERT INTO workflows (id, name, description, trigger_type, published, graph_hash)
      VALUES (7, 'Current TV Flow', '', 'manual', 1, 'current_graph_hash')
    `).run()
    memoryAssets.recordExperiencePath({
      id: 'memory.experience_path.workflow.stale_watch_tv',
      title: '看电视旧路径',
      summary: '旧图版本运行过的看电视路径',
      intent_pattern: '看电视',
      steps: [
        { tool: 'workflow', action: 'run_workflow', params: { workflow_id: 7, inputs: { device_id: 2 } } },
      ],
      metadata: {
        workflow_id: 7,
        workflow_graph_hash: 'previous_graph_hash',
        workflow_inputs: { device_id: 2 },
      },
      source: 'runtime',
    })

    const context = buildRuntimeContextWindow({
      conversationId: 1,
      messages: [{ role: 'user', content: '我要看电视' }],
      retrievalLimit: 3,
      getDb: () => db,
    })

    expect(context.retrieval_hits).toEqual([])
  })
})
