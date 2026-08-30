async function sendMessage() {
  const message = prompt.value
  if (loading.value) return
  if (!message || message.trim() === '') return

  const previousDraftId = latestAssistantWorkflowDraftId()

  loading.value = true
  prompt.value = ''

  const userMsg: ChatMessage = {
    id: Date.now(),
    role: 'user',
    content: message,
    created_at: new Date().toISOString(),
    dateTime: new Date().toLocaleString(),
    text: message,
    inversion: true,
    error: false,
    loading: false,
  }
  messages.value.push(userMsg)
  scrollToBottom()

  const thinkingMsg: ChatMessage = {
    id: Date.now() + 1,
    role: 'assistant',
    content: '思考中...',
    created_at: new Date().toISOString(),
    dateTime: new Date().toLocaleString(),
    text: '思考中...',
    inversion: false,
    error: false,
    loading: true,
    trace: [],
    writeBackResults: [],
    llm: undefined,
    skillsHint: [],
  }
  messages.value.push(thinkingMsg)
  scrollToBottom()

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
    const res = await response.json()

    messages.value[messages.value.length - 1] = {
      ...thinkingMsg,
      text: res.data?.reply || '完成',
      content: res.data?.reply || '完成',
      error: false,
      loading: false,
      trace: res.data?.trace || [],
      writeBackResults: res.data?.writeBackResults || [],
      llm: res.data?.llm,
      skillsHint: res.data?.skillsHint || [],
    }
    syncRuntimePanelFromMessages()
    handleIncomingWorkflowDraft(previousDraftId)
    scrollToBottom()
  } catch (error: any) {
    const errorMessage = error?.message ?? '出错了'
    messages.value[messages.value.length - 1] = {
      ...thinkingMsg,
      text: errorMessage,
      content: errorMessage,
      error: true,
      loading: false,
    }
    scrollToBottomIfAtBottom()
  } finally {
    loading.value = false
  }
}

function handleStop() {
  fetch('/api/abort')
  loading.value = false
}

function handleClear() {
  if (loading.value) return
  messages.value = []
  hasMoreOlder.value = false
  oldestCursorId.value = null
  runtimePanelStore.clearRuntime()
  clearCachedMessages()
}
