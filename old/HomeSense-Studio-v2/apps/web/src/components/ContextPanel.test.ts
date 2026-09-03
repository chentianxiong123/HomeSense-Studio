import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import ContextPanel from './ContextPanel.vue'

const apiMocks = vi.hoisted(() => {
  type Entry = {
    key: string
    value: string
    updated_at: string
    active: boolean
    age_ms: number
    ttl_ms: number
  }

  const makeEntry = (key: string, value: string): Entry => ({
    key,
    value,
    updated_at: new Date().toISOString(),
    active: Boolean(value),
    age_ms: 0,
    ttl_ms: 30 * 60 * 1000,
  })

  const entries: Record<string, Entry> = {}
  const rooms = [
    { id: 1, name: '客厅', created_at: '', updated_at: '' },
    { id: 2, name: '卧室', created_at: '', updated_at: '' },
  ]
  const cards = [
    {
      id: 10,
      name: '客厅电视',
      device_type: 'television',
      room: { id: 1, name: '客厅' },
      sources: [],
      bindings: { mi_did: null, adb_ip: null, ip_address: null },
      network: { ping_target: null, online: true, checked: true, method: 'none' },
      display: { icon: 'tv', title: '客厅电视', subtitle: '客厅', status: 'online' },
    },
    {
      id: 20,
      name: '卧室音箱',
      device_type: 'speaker',
      room: { id: 2, name: '卧室' },
      sources: [],
      bindings: { mi_did: null, adb_ip: null, ip_address: null },
      network: { ping_target: null, online: true, checked: true, method: 'none' },
      display: { icon: 'speaker', title: '卧室音箱', subtitle: '卧室', status: 'online' },
    },
  ]

  const runtimeMock = vi.fn(async () => ({
    context: {
      entries,
      working_context: {},
      recent_messages: [],
      retrieval_hits: [],
      context_usage: {
        used_tokens: 0,
        max_tokens: 20_000,
        message_tokens: 0,
        working_context_tokens: 0,
        retrieval_tokens: 0,
      },
      max_turns: 12,
      ttl_ms: 30 * 60 * 1000,
      retrieval_limit: 3,
      context_token_budget: 20_000,
      session_active: true,
      last_activity_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    },
  }))

  const setMock = vi.fn(async (key: string, value: string) => {
    entries[key] = makeEntry(key, value)
    return { status: 'ok' }
  })

  return {
    entries,
    makeEntry,
    runtimeMock,
    setMock,
    roomsListMock: vi.fn(async () => ({ rooms })),
    cardsMock: vi.fn(async () => ({ cards })),
    capabilitiesMock: vi.fn(async () => ({ status: 'success', data: { capabilities: [] } })),
    chatModelsMock: vi.fn(async () => ({ models: [] })),
    updateSettingsMock: vi.fn(),
  }
})

vi.mock('@/api', () => ({
  api: {
    userContext: {
      runtime: apiMocks.runtimeMock,
      set: apiMocks.setMock,
      updateSettings: apiMocks.updateSettingsMock,
    },
    rooms: {
      list: apiMocks.roomsListMock,
    },
    userDevices: {
      cards: apiMocks.cardsMock,
      capabilities: apiMocks.capabilitiesMock,
    },
    llm: {
      chatModels: apiMocks.chatModelsMock,
      selectModel: vi.fn(),
    },
  },
}))

describe('ContextPanel context sync', () => {
  beforeEach(() => {
    for (const key of Object.keys(apiMocks.entries)) delete apiMocks.entries[key]
    apiMocks.runtimeMock.mockClear()
    apiMocks.setMock.mockClear()
    apiMocks.roomsListMock.mockClear()
    apiMocks.cardsMock.mockClear()
    apiMocks.capabilitiesMock.mockClear()
    apiMocks.chatModelsMock.mockClear()
  })

  it('clears the backend current device when selecting an incompatible room', async () => {
    apiMocks.entries.current_room = apiMocks.makeEntry('current_room', '1')
    apiMocks.entries.current_device = apiMocks.makeEntry('current_device', '10')

    const wrapper = mount(ContextPanel)
    await flushPromises()
    apiMocks.setMock.mockClear()

    await wrapper.findAll('.ctx-row')[0].trigger('click')
    await flushPromises()
    const bedroomOption = wrapper.findAll('.ctx-opt').find((option: { text(): string }) => option.text().includes('卧室'))
    expect(bedroomOption).toBeDefined()
    await bedroomOption!.trigger('click')
    await flushPromises()

    expect(apiMocks.setMock).toHaveBeenCalledWith('current_room', '2')
    expect(apiMocks.setMock).toHaveBeenCalledWith('current_device', '')
  })

  it('syncs backend current room to the selected device room', async () => {
    const wrapper = mount(ContextPanel)
    await flushPromises()
    apiMocks.setMock.mockClear()

    await wrapper.findAll('.ctx-row')[1].trigger('click')
    await flushPromises()
    const speakerOption = wrapper.findAll('.ctx-opt').find((option: { text(): string }) => option.text().includes('卧室音箱'))
    expect(speakerOption).toBeDefined()
    await speakerOption!.trigger('click')
    await flushPromises()

    expect(apiMocks.setMock).toHaveBeenCalledWith('current_device', '20')
    expect(apiMocks.setMock).toHaveBeenCalledWith('current_room', '2')
  })
})
