import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from './index'

describe('api.chat', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('exposes the current stream endpoint', () => {
    expect(api.chat.streamUrl()).toBe('/api/chat/stream')
  })

  it('loads flat chat messages from the current messages endpoint', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ messages: [], hasMore: false }),
    } as Response)

    await api.chat.messages(12, 30)

    expect(fetchMock).toHaveBeenCalledWith('/api/chat/messages?cursor=12&limit=30', {
      headers: undefined,
    })
  })

  it('prefixes chat endpoints with VITE_API_BASE when configured', async () => {
    vi.stubEnv('VITE_API_BASE', 'http://127.0.0.1:3132')
    vi.resetModules()
    const { api: apiWithBase } = await import('./index')

    expect(apiWithBase.chat.streamUrl()).toBe('http://127.0.0.1:3132/api/chat/stream')

    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      json: async () => ({ messages: [], hasMore: false }),
    } as Response)

    await apiWithBase.chat.messages()

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:3132/api/chat/messages', {
      headers: undefined,
    })
  })
})
