import { describe, expect, it } from 'vitest'
import { normalizePersistedMessages } from './persistedMessages'

describe('normalizePersistedMessages', () => {
  it('merges persisted tool rows back into the assistant tool card', () => {
    const messages = normalizePersistedMessages([
      {
        id: 1,
        role: 'user',
        content: '打开电视',
        created_at: '2026-05-31T01:00:00.000Z',
      },
      {
        id: 2,
        role: 'assistant',
        content: '',
        tool_calls_json: JSON.stringify([
          {
            id: 'call_1',
            function: {
              name: 'execute_device_capability',
              arguments: JSON.stringify({ device_id: 8, capability: '开机' }),
            },
          },
        ]),
        created_at: '2026-05-31T01:00:01.000Z',
      },
      {
        id: 3,
        role: 'tool',
        content: JSON.stringify({ capability: '开机', predicted_effect: '电视将开机' }),
        tool_call_id: 'call_1',
        created_at: '2026-05-31T01:00:02.000Z',
      },
      {
        id: 4,
        role: 'assistant',
        content: '已执行。',
        created_at: '2026-05-31T01:00:03.000Z',
      },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '已执行。',
    })
    expect(messages[1].toolCalls?.[0]).toMatchObject({
      call_id: 'call_1',
      name: 'execute_device_capability',
      status: 'success',
      capability: '开机',
      predictedEffect: '电视将开机',
    })
  })

  it('does not render orphan tool rows as chat messages', () => {
    const messages = normalizePersistedMessages([
      {
        id: 10,
        role: 'tool',
        content: JSON.stringify({ ok: true }),
        tool_call_id: 'missing',
        created_at: '2026-05-31T01:00:00.000Z',
      },
    ])

    expect(messages).toEqual([])
  })

  it('replays workflow tool rows into assistant tool cards', () => {
    const messages = normalizePersistedMessages([
      {
        id: 20,
        role: 'user',
        content: '执行看电视流程',
        created_at: '2026-05-31T01:00:00.000Z',
      },
      {
        id: 21,
        role: 'assistant',
        content: '',
        tool_calls_json: JSON.stringify([
          {
            id: 'call_workflow',
            function: {
              name: 'run_workflow',
              arguments: JSON.stringify({ workflow_id: 9, workflow_name: '看电视', inputs: { device_id: 2 } }),
            },
          },
        ]),
        created_at: '2026-05-31T01:00:01.000Z',
      },
      {
        id: 22,
        role: 'tool',
        content: JSON.stringify({
          input_source: 'memory',
          preview: { workflow_id: 9, executable: true, input_source: 'memory', warnings: [], steps: [] },
          run: { run_id: 31, workflow_id: 9, status: 'succeeded', outputs: { ok: true }, trace: [] },
        }),
        tool_call_id: 'call_workflow',
        created_at: '2026-05-31T01:00:02.000Z',
      },
      {
        id: 23,
        role: 'assistant',
        content: '流程已完成。',
        created_at: '2026-05-31T01:00:03.000Z',
      },
    ])

    expect(messages).toHaveLength(2)
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      content: '流程已完成。',
    })
    expect(messages[1].toolCalls?.[0]).toMatchObject({
      call_id: 'call_workflow',
      name: 'run_workflow',
      status: 'success',
      result: {
        input_source: 'memory',
        preview: { workflow_id: 9, executable: true, input_source: 'memory', warnings: [], steps: [] },
        run: { run_id: 31, workflow_id: 9, status: 'succeeded', outputs: { ok: true }, trace: [] },
      },
    })
  })
})
