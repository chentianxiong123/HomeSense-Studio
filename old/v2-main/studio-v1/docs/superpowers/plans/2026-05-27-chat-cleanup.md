# Chat Cleanup: Simplify ChatView + Fix Broken Imports

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken ChatView.vue (which imports removed functions/types) to work with the already-simplified useChat.ts, while preserving the three-pane layout (left sidebar, center chat, right sidebar).

**Architecture:** `useChat.ts` has already been simplified (stripped from complex agent-event parsing to basic SSE). But `ChatView.vue` was never updated — it still imports `loadConversation`, `DisplayMessage` from deleted `types/chat`, and renders components (ToolCallCard, PlanStepTimeline, MemoryChip, etc.) that depend on the old complex DisplayMessage shape. We need to fix ChatView.vue to match the simplified composable.

**Tech Stack:** Vue 3 + TypeScript + Composition API

---

## Current State Analysis

**What's broken in ChatView.vue:**
1. `import type { DisplayMessage } from '../types/chat'` — file doesn't exist
2. `loadConversation` destructured from `useChat()` — not exported by simplified useChat
3. `sendMessage(action.text, { agentInstanceId: ... })` — simplified sendMessage takes only `text: string`
4. Template uses `msg.toolCalls`, `msg.memoryHits`, `msg.planSteps`, `msg.approvals`, `msg.a2aDispatches`, `msg.routePreview`, `msg.candidatePlans`, `msg.contextPatch`, `msg.level`, `msg.durationMs` — none exist on simplified DisplayMessage
5. Imports components that render the above: ToolCallCard, PlanStepTimeline, MemoryChip, RoutePreviewCard, A2ADispatchCard, ApprovalCard, PlanPreviewCard

**What's already working:**
- `useChat.ts` — simplified, correct
- Three-pane layout (left/center/right) — good structure
- Left sidebar (Explorer) — good
- ConversationSidebar component — standalone, works via API

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `packages/frontend/src/views/ChatView.vue` | Rewrite | Fix all broken imports, remove dead template code, keep 3-pane layout |
| `packages/frontend/src/composables/useChat.ts` | Keep as-is | Already simplified correctly |

## Tasks

### Task 1: Fix ChatView.vue — imports and script

**Files:**
- Modify: `packages/frontend/src/views/ChatView.vue:1-171` (script section)

- [ ] **Step 1: Rewrite the script section of ChatView.vue**

Replace the entire `<script setup>` block. Key changes:
- Remove `import type { DisplayMessage } from '../types/chat'` — use the type from useChat.ts instead
- Remove `loadConversation` from destructuring
- Remove imports of: PlanPreviewCard, ToolCallCard, PlanStepTimeline, MemoryChip, RoutePreviewCard, A2ADispatchCard, ApprovalCard
- Remove agent instance logic (loadAgents, agentInstances, selectedAgentId)
- Remove btwItems + event bus listeners (cron_fired, memory_observation, service_called, workflow_completed)
- Remove resolveApproval, levelLabel, levelColor functions
- Remove lastAssistant computed (it accesses removed fields)
- Remove quickActions computed (hardcoded Chinese text)
- Keep: inputText, textarea, adjustTextareaHeight, showLeftPane, showRightPane, selectedDevice, onSend, onKeydown, formatTime

New script content:

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import DeviceSidebar from '../components/DeviceSidebar.vue'
import ConversationSidebar from '../components/chat/ConversationSidebar.vue'
import ManifestExplorer from '../components/ManifestExplorer.vue'
import { useChat } from '../composables/useChat'
import { useLocale } from '../composables/useLocale'
import type { DeviceInfo } from '../api'

const {
  messages,
  conversationId,
  loading,
  messageListRef,
  sendMessage,
  stopStreaming,
  newConversation,
  directLLM,
} = useChat()

const inputText = ref('')
const textarea = ref<HTMLTextAreaElement | null>(null)
const showLeftPane = ref(true)
const showRightPane = ref(true)
const selectedDevice = ref<DeviceInfo | null>(null)
const { t, locale } = useLocale()

function adjustTextareaHeight() {
  if (!textarea.value) return
  textarea.value.style.height = 'auto'
  textarea.value.style.height = `${Math.min(textarea.value.scrollHeight, 200)}px`
}

watch(inputText, () => adjustTextareaHeight())

function onSend() {
  if (!inputText.value.trim()) return
  const text = inputText.value
  inputText.value = ''
  if (textarea.value) textarea.value.style.height = 'auto'
  sendMessage(text)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault()
    onSend()
  }
}

function formatTime(date: Date) {
  return date.toLocaleTimeString(locale.value === 'zh' ? 'zh-CN' : 'en-US', {
    hour: '2-digit',
    minute: '2-digit',
  })
}

async function loadConversation(id: number) {
  // Re-implemented inline: fetch messages for a conversation
  const { api } = await import('../api')
  const result = await api.chat.messages(id)
  conversationId.value = id
  messages.value = result.messages.map((m) => ({
    id: `msg_${m.id}`,
    role: m.role as 'user' | 'assistant' | 'system',
    content: m.content,
    status: 'final' as const,
    timestamp: new Date(m.created_at),
  }))
  nextTick(() => {
    if (messageListRef.value) {
      messageListRef.value.scrollTop = messageListRef.value.scrollHeight
    }
  })
}
</script>
```

Note: `loadConversation` is re-implemented inline since ConversationSidebar emits `@select` with a conversation ID.

- [ ] **Step 2: Verify the import of nextTick is present**

The `loadConversation` function uses `nextTick`. Add it to the Vue import:

```ts
import { ref, watch, nextTick } from 'vue'
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/views/ChatView.vue
git commit -m "fix: update ChatView script useChat API"
```

### Task 2: Fix ChatView.vue — template

**Files:**
- Modify: `packages/frontend/src/views/ChatView.vue:173-401` (template section)

- [ ] **Step 1: Simplify the template**

Keep the three-pane structure. Remove all references to non-existent message properties.

New template content:

```vue
<template>
  <div class="chat-view">
    <!-- Left sidebar: conversations + manifests -->
    <aside class="left-pane" :class="{ collapsed: !showLeftPane }">
      <div class="pane-split">
        <div class="pane-conv">
          <ConversationSidebar
            :active-id="conversationId"
            @select="(id) => loadConversation(id)"
            @new="newConversation"
          />
        </div>
        <div class="pane-manifests">
          <ManifestExplorer layout="sidebar" />
        </div>
      </div>
    </aside>

    <!-- Center: chat messages -->
    <section class="center-pane">
      <div class="chat-toolbar">
        <button class="toolbar-btn" @click="showLeftPane = !showLeftPane">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: showLeftPane ? '' : 'rotate(180deg)' }">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
        </button>
        <button class="toolbar-btn text-btn primary-hover" @click="newConversation">{{ t('chat.newChat') }}</button>
        <button
          v-if="loading"
          class="toolbar-btn stop text-btn"
          @click="stopStreaming"
        >{{ t('chat.stop') }}</button>
        <button
          class="toolbar-btn text-btn"
          :class="{ 'direct-active': directLLM }"
          @click="directLLM = !directLLM"
          :title="locale === 'zh' ? '跳过意图路由，直接送 LLM' : 'Bypass intent router, direct to LLM'"
        >{{ directLLM ? 'Direct' : 'Router' }}</button>
        <div v-if="selectedDevice" class="selected-device">{{ selectedDevice.name }}</div>
        <button class="toolbar-btn right" @click="showRightPane = !showRightPane">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" :style="{ transform: showRightPane ? '' : 'rotate(180deg)' }">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>

      <div ref="messageListRef" class="message-list">
        <div v-if="messages.length === 0" class="welcome">
          <span class="eyebrow">{{ locale === 'zh' ? '对话式控制中心' : 'Conversational AI' }}</span>
          <h2>{{ t('chat.welcomeTitle') }}</h2>
          <p>{{ t('chat.welcomeSubtitle') }}</p>
        </div>

        <div
          v-for="msg in messages"
          :key="msg.id"
          :class="['message-row', msg.role]"
        >
          <div :class="['message-bubble', msg.role, msg.status]">
            <div v-if="msg.content" class="message-content">{{ msg.content }}</div>
            <div v-else-if="msg.status === 'streaming' && msg.role === 'assistant'" class="typing">
              <span class="dot"></span><span class="dot"></span><span class="dot"></span>
            </div>
          </div>
          <div class="message-time">{{ formatTime(msg.timestamp) }}</div>
        </div>
      </div>

      <div class="input-area">
        <div class="input-wrapper">
          <textarea
            ref="textarea"
            v-model="inputText"
            class="chat-input"
            :placeholder="t('chat.placeholder)"
            rows="1"
            :disabled="loading"
            @keydown="onKeydown"
          ></textarea>
          <button class="send-btn" :disabled="loading || !inputText.trim()" @click="onSend">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" v-if="!loading">
              <line x1="22" y1="2" x2="11" y2="13"></line>
              <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
            </svg>
            <span v-else class="btn-spinner"></span>
          </button>
        </div>
      </div>
    </section>

    <!-- Right sidebar: device control -->
    <aside class="right-pane" :class="{ collapsed: !showRightPane }">
      <div class="pane-head"><span>{{ locale === 'zh' ? '���备' : 'Devices' }}</span></div>
      <div class="pane-section">
        <div class="pane-label">{{ t('chat.devices') }}</div>
        <DeviceSidebar class="device-embed" @select="(device) => (selectedDevice = device)" />
      </div>
    </aside>
  </div>
</template>
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/views/ChatView.vue
git commit -m "fix: simplify ChatView template to match simplified useChat"
```

### Task 3: Clean up unused imports in ChatView.vue

**Files:**
- Modify: `packages/frontend/src/views/ChatView.vue` (script imports)

- [ ] **Step 1: Remove unused component imports**

After Task 1 and 2, verify that the following imports are no longer needed and remove any that remain:
- `PlanPreviewCard`
- `ToolCallCard`
- `PlanStepTimeline`
- `MemoryChip`
- `RoutePreviewCard`
- `A2ADispatchCard`
- `ApprovalCard`
- `BtwStrip`
- `useEventBus`
- `api` (unless used by loadConversation)
- `DeviceInfo` (only if selectedDevice is removed)

- [ ] **Step 2: Run type check**

```bash
cd packages/frontend && npx vue-tsc --noEmit 2>&1 | head -50
```

Expected: No errors related to ChatView.vue or useChat.ts.

- [ ] **Step 3: Commit if any cleanup was needed**

```bash
git add packages/frontend/src/views/ChatView.vue
git commit -m "chore: remove unused ChatView imports"
```

### Task 4: Delete or archive old chat composable (optional — user decision)

**Files:**
- Consider: `packages/frontend/src/composables/useChat.ts`

The current `useChat.ts` is already simplified. The user mentioned "delete or archive the old one." Since the composable is already cleaned up and ChatView.vue now uses it correctly, this is likely fine as-is.

If the user wants to inline the logic into ChatView.vue instead:
- Move the contents of useChat.ts directly into ChatView.vue's `<script setup>`
- Delete `packages/frontend/src/composables/useChat.ts`

- [ ] **Step 1: Confirm with user whether to keep or inline useChat.ts**
- [ ] **Step 2: If inlining, move logic and delete file**
- [ ] **Step 3: Commit**

## Verification

1. Run `npx vue-tsc --noEmit` in `packages/frontend/` — should pass
2. Run the dev server and navigate to `/chat`: shows conversation list + manifest explorer
   - Center shows chat input with welcome screen
   - Right sidebar shows device list
   - Send a message — should stream response via SSE
   - Toggle left/right sidebars — should collapse/expand
   - Click a conversation in left sidebar — should load messages
3. No TypeScript errors in the terminal
