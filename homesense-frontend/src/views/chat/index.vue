<script setup lang="ts">
import type { Ref } from 'vue'
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { NButton, NInput } from 'naive-ui'
import { Message } from './components'
import { useScroll } from './hooks/useScroll'
import HeaderComponent from './components/Header/index.vue'
import { HoverButton, SvgIcon } from '@/components/common'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { fetchChatAPI, fetchMessages } from '@/api'
import { t } from '@/locales'
import { setCachedMessages, clearCachedMessages } from '@/utils/cache'

useRoute()

const { isMobile } = useBasicLayout()
const { scrollRef, scrollToBottom, scrollToBottomIfAtBottom } = useScroll()


interface StageTraceEntry {
  stage: string
  ok: boolean
  next: string
  message?: string
  reason?: string
  confidence?: number
}

interface WriteBackResult {
  type: string
  success: boolean
  message?: string
  pathName?: string
  successState?: boolean
}

interface LlmData {
  intent_hint?: string
  plan?: string[]
  suggested_actions?: Array<{ tool: string, action: string }>
  next_hint?: string
  needs_model_config?: boolean
  selected_skills?: string[]
  selected_skill_refs?: string[]
  skill_insights?: Array<{ tool: string, section: string, headline?: string }>
  context_summary?: {
    selectedSkills?: Array<{ tool: string, section: string }>
  }
}

interface ChatMessage {
  id: number
  role: string
  content: string
  created_at: string
  dateTime: string
  text: string
  inversion: boolean
  error: boolean
  loading: boolean
  trace?: StageTraceEntry[]
  writeBackResults?: WriteBackResult[]
  llm?: LlmData
  skillsHint?: string[]
}

const messages = ref<ChatMessage[]>([])
const prompt = ref<string>('')
const loading = ref<boolean>(false)
const loadingMore = ref<boolean>(false)
const hasMore = ref<boolean>(true)
const inputRef = ref<Ref | null>(null)

const PAGE_SIZE = 20

function formatMessage(msg: any): ChatMessage {
  const date = new Date(msg.created_at || Date.now())
  const utcTime = date.getTime()
  const chinaTime = new Date(utcTime + 8 * 60 * 60 * 1000)
  return {
    id: msg.id || Date.now(),
    role: msg.role,
    content: msg.content,
    created_at: msg.created_at,
    dateTime: `${chinaTime.getFullYear()}/${String(chinaTime.getMonth() + 1).padStart(2, '0')}/${String(chinaTime.getDate()).padStart(2, '0')} ${String(chinaTime.getHours()).padStart(2, '0')}:${String(chinaTime.getMinutes()).padStart(2, '0')}:${String(chinaTime.getSeconds()).padStart(2, '0')}`,
    text: msg.content,
    inversion: msg.role === 'user',
    error: false,
    loading: false,
    trace: msg.trace || [],
    writeBackResults: msg.writeBackResults || [],
    llm: msg.llm,
    skillsHint: msg.skillsHint || [],
  }
}

async function loadFromBackend(offset = 0, append = false) {
  if (append) {
    loadingMore.value = true
  }

  try {
    const res = await fetchMessages<{ messages: any[], total: number }>(PAGE_SIZE, offset)
    const backendMessages = res.data?.messages || []

    if (!append) {
      const formatted = backendMessages.map(formatMessage)
      messages.value = formatted
      setCachedMessages(formatted)
      hasMore.value = backendMessages.length === PAGE_SIZE
      scrollToBottom()
    } else {
      if (backendMessages.length > 0) {
        const container = scrollRef.value
        const prevScrollHeight = container?.scrollHeight || 0

        const formatted = backendMessages.map(formatMessage)
        messages.value = [...messages.value, ...formatted]
        hasMore.value = backendMessages.length === PAGE_SIZE

        await new Promise(r => setTimeout(r, 50))
        if (container) {
          container.scrollTop = container.scrollHeight - prevScrollHeight
        }
      }
    }

    if (backendMessages.length < PAGE_SIZE) {
      hasMore.value = false
    }
  } catch (error) {
    console.error('Failed to load from backend:', error)
  } finally {
    loadingMore.value = false
  }
}

async function initMessages() {
  // TODO: 暂时禁用缓存，直接从后端加载
  // loadFromCache()
  await loadFromBackend(0, false)
}

async function handleScroll() {
  const container = scrollRef.value
  if (!container || loadingMore.value || !hasMore.value) return
  if (container.scrollTop < 50) {
    await loadFromBackend(messages.value.length, true)
  }
}

async function sendMessage() {
  const message = prompt.value
  if (loading.value) return
  if (!message || message.trim() === '') return

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
    content: t('chat.thinking'),
    created_at: new Date().toISOString(),
    dateTime: new Date().toLocaleString(),
    text: t('chat.thinking'),
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
    const res = await fetchChatAPI(message)

    messages.value[messages.value.length - 1] = {
      ...thinkingMsg,
      text: res.data?.reply || '好的',
      content: res.data?.reply || '好的',
      error: false,
      loading: false,
      trace: res.data?.trace || [],
      writeBackResults: res.data?.writeBackResults || [],
      llm: res.data?.llm,
      skillsHint: res.data?.skillsHint || [],
    }
    scrollToBottom()
  } catch (error: any) {
    const errorMessage = error?.message ?? t('common.wrong')
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

function handleClear() {
  if (loading.value) return
  messages.value = []
  clearCachedMessages()
}

function handleDelete(index: number) {
  if (loading.value) return
  messages.value.splice(index, 1)
  setCachedMessages(messages.value)
}

function handleEnter(event: KeyboardEvent) {
  if (!isMobile.value) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      sendMessage()
    }
  } else {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault()
      sendMessage()
    }
  }
}

const placeholder = computed(() => {
  if (isMobile.value) return t('chat.placeholderMobile')
  return t('chat.placeholder')
})

const buttonDisabled = computed(() => {
  return loading.value || !prompt.value || prompt.value.trim() === ''
})

const footerClass = computed(() => {
  let classes = ['p-4']
  if (isMobile.value) classes = ['sticky', 'left-0', 'bottom-0', 'right-0', 'p-2', 'pr-3', 'overflow-hidden']
  return classes
})

onMounted(() => {
  initMessages()
  if (inputRef.value && !isMobile.value) inputRef.value?.focus()
})
</script>

<template>
  <div class="flex flex-col w-full h-full">
    <HeaderComponent
      v-if="isMobile"
      :using-context="false"
      @export="() => {}"
      @handle-clear="handleClear"
    />
    <main class="flex-1 overflow-hidden">
      <div id="scrollRef" ref="scrollRef" class="h-full overflow-hidden overflow-y-auto" @scroll="handleScroll">
        <div
          class="w-full max-w-screen-xl m-auto dark:bg-[#101014]"
          :class="[isMobile ? 'p-2' : 'p-4']"
        >
          <div id="image-wrapper" class="relative">
            <template v-if="loadingMore">
              <div class="flex justify-center py-4">
                <div class="animate-spin h-5 w-5 border-2 border-blue-500 border-t-transparent rounded-full" />
              </div>
            </template>
            <template v-if="!messages.length && !loadingMore">
              <div class="flex items-center justify-center mt-4 text-center text-neutral-300">
                <SvgIcon icon="ri:bubble-chart-fill" class="mr-2 text-3xl" />
                <span>{{ t('chat.newChatTitle') }}</span>
              </div>
            </template>
            <template v-else>
              <div>
                <Message
                  v-for="(item, index) of messages"
                  :key="item.id"
                  :date-time="item.dateTime"
                  :text="item.text"
                  :inversion="item.inversion"
                  :error="item.error"
                  :loading="item.loading"
                  :trace="item.trace"
                  :write-back-results="item.writeBackResults"
                  :llm="item.llm"
                  :skills-hint="item.skillsHint"
                  @regenerate="() => {}"
                  @delete="handleDelete(index)"
                />
                <div class="sticky bottom-0 left-0 flex justify-center">
                  <NButton v-if="loading" type="warning">
                    <template #icon>
                      <SvgIcon icon="ri:loader-4-line" class="animate-spin" />
                    </template>
                    处理中...
                  </NButton>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </main>
    <footer :class="footerClass">
      <div class="w-full max-w-screen-xl m-auto">
        <div class="flex items-center justify-between space-x-2">
          <HoverButton v-if="!isMobile" @click="handleClear">
            <span class="text-xl text-[#4f555e] dark:text-white">
              <SvgIcon icon="ri:delete-bin-line" />
            </span>
          </HoverButton>
          <NInput
            ref="inputRef"
            v-model:value="prompt"
            type="textarea"
            :placeholder="placeholder"
            :autosize="{ minRows: 1, maxRows: isMobile ? 4 : 8 }"
            @keypress="handleEnter"
          />
          <NButton type="primary" :disabled="buttonDisabled" @click="sendMessage">
            <template #icon>
              <span class="dark:text-black">
                <SvgIcon icon="ri:send-plane-fill" />
              </span>
            </template>
          </NButton>
        </div>
      </div>
    </footer>
  </div>
</template>
