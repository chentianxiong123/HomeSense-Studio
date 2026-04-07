const LOCAL_NAME = 'chat_messages'

export interface CachedMessages {
  messages: any[]
  lastUpdated: number
}

export function getCachedMessages(): CachedMessages | null {
  try {
    const data = localStorage.getItem(LOCAL_NAME)
    if (data) {
      return JSON.parse(data)
    }
  } catch (e) {
    console.error('Failed to read cache:', e)
  }
  return null
}

export function setCachedMessages(messages: any[]): void {
  try {
    const data: CachedMessages = {
      messages,
      lastUpdated: Date.now(),
    }
    localStorage.setItem(LOCAL_NAME, JSON.stringify(data))
  } catch (e) {
    console.error('Failed to write cache:', e)
  }
}

export function appendCachedMessages(newMessages: any[]): void {
  try {
    const cached = getCachedMessages()
    const messages = cached ? [...newMessages, ...cached.messages] : newMessages
    setCachedMessages(messages)
  } catch (e) {
    console.error('Failed to append cache:', e)
  }
}

export function clearCachedMessages(): void {
  try {
    localStorage.removeItem(LOCAL_NAME)
  } catch (e) {
    console.error('Failed to clear cache:', e)
  }
}
