<script setup lang="ts">
import { computed } from 'vue'
import RuntimeTraceCard from './RuntimeTraceCard.vue'
import RuntimeToolCard from './RuntimeToolCard.vue'
import type { DisplayMessage, ToolCallState } from '../../composables/useChat'
import { collectSuccessfulPathToolCalls } from '../../features/chat/experiencePathTools'

const props = defineProps<{
  msg: DisplayMessage
  locale: string
  showRuntimeTrace: boolean
}>()

const emit = defineEmits<{
  (event: 'toggle-thinking'): void
  (event: 'toggle-trace'): void
  (event: 'toggle-tool', toolCall: ToolCallState): void
  (event: 'save-path'): void
  (event: 'save-workflow'): void
  (event: 'open-workflow'): void
}>()

const canPromotePath = computed(() => {
  if (props.msg.role !== 'assistant' || props.msg.status === 'streaming') return false
  if (props.msg.pathSaveStatus === 'saved' || props.msg.workflowSaveStatus === 'saved') return true
  if (props.msg.pathCandidate?.steps?.length) return true
  return collectSuccessfulPathToolCalls(props.msg.toolCalls ?? []).length > 0
})

function pathButtonLabel(): string {
  if (props.msg.pathSaveStatus === 'saving') return props.locale === 'zh' ? '沉淀中' : 'Saving'
  if (props.msg.pathSaveStatus === 'saved') return props.locale === 'zh' ? '已沉淀为路径' : 'Saved as Path'
  if (props.msg.pathSaveStatus === 'error') return props.locale === 'zh' ? '重试沉淀' : 'Retry Save'
  return props.locale === 'zh' ? '沉淀为路径' : 'Save as Path'
}

function workflowButtonLabel(): string {
  if (props.msg.workflowSaveStatus === 'saving') return props.locale === 'zh' ? '保存中' : 'Saving'
  if (props.msg.workflowSaveStatus === 'saved') {
    const suffix = props.msg.workflowId ? ` #${props.msg.workflowId}` : ''
    return props.locale === 'zh' ? `已保存为工作流${suffix}` : `Saved as Workflow${suffix}`
  }
  if (props.msg.workflowSaveStatus === 'error') return props.locale === 'zh' ? '重试工作流' : 'Retry Workflow'
  return props.locale === 'zh' ? '保存为工作流' : 'Save as Workflow'
}
</script>

<template>
  <div :class="['bubble', msg.role, msg.status]">
    <div v-if="msg.thinking" class="think-card" :class="{ collapsed: !msg.thinkingExpanded }">
      <button class="think-toggle" @click="emit('toggle-thinking')">
        <svg :style="{ transform: msg.thinkingExpanded ? 'rotate(90deg)' : '' }" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        <span>{{ msg.status === 'streaming' ? (locale === 'zh' ? '思考中...' : 'Thinking...') : (locale === 'zh' ? '思考过程' : 'Thinking') }}</span>
      </button>
      <div v-show="msg.thinkingExpanded" class="think-content">{{ msg.thinking }}</div>
    </div>

    <RuntimeTraceCard
      v-if="showRuntimeTrace && msg.runtimeTrace && msg.runtimeTrace.length > 0"
      :trace="msg.runtimeTrace"
      :expanded="Boolean(msg.traceExpanded)"
      @toggle="emit('toggle-trace')"
    />

    <div v-if="msg.toolCalls && msg.toolCalls.length > 0" class="tool-calls-container">
      <RuntimeToolCard
        v-for="tc in msg.toolCalls"
        :key="tc.call_id"
        :tool-call="tc"
        :locale="locale"
        @toggle="emit('toggle-tool', tc)"
      />
    </div>

    <div v-if="msg.content" class="content">{{ msg.content }}</div>
    <div v-else-if="msg.status === 'streaming' && msg.role === 'assistant' && !msg.thinking && (!msg.toolCalls || msg.toolCalls.length === 0)" class="typing">
      <span class="dot"></span><span class="dot"></span><span class="dot"></span>
    </div>

    <div v-if="canPromotePath" class="path-action">
      <button
        type="button"
        class="path-save-btn"
        :disabled="msg.pathSaveStatus === 'saving' || msg.pathSaveStatus === 'saved'"
        @click="emit('save-path')"
      >
        {{ pathButtonLabel() }}
      </button>
      <button
        type="button"
        class="workflow-save-btn"
        :disabled="msg.workflowSaveStatus === 'saving' || msg.workflowSaveStatus === 'saved'"
        @click="emit('save-workflow')"
      >
        {{ workflowButtonLabel() }}
      </button>
      <button
        v-if="msg.workflowSaveStatus === 'saved' && msg.workflowId"
        type="button"
        class="workflow-open-btn"
        @click="emit('open-workflow')"
      >
        {{ locale === 'zh' ? '打开编排器' : 'Open Editor' }}
      </button>
      <span v-if="msg.pathSaveStatus === 'error'" class="path-save-error">
        {{ msg.pathSaveError || (locale === 'zh' ? '保存失败' : 'Save failed') }}
      </span>
      <span v-if="msg.workflowSaveStatus === 'error'" class="path-save-error">
        {{ msg.workflowSaveError || (locale === 'zh' ? '工作流保存失败' : 'Workflow save failed') }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.bubble {
  max-width: min(85%, 800px);
  padding: 24px 36px;
  line-height: 1.8;
  font-size: 15px;
  font-weight: 700;
  word-break: break-word;
  letter-spacing: -0.01em;
}
.bubble.user {
  color: var(--text-primary);
  border-bottom-right-radius: 10px;
}
.bubble.assistant {
  color: var(--text-primary);
  border-bottom-left-radius: 10px;
}
.bubble.error { color: #ef4444; }
.bubble.streaming {
  border: 2px dashed rgba(16, 185, 129, 0.4);
  background: rgba(255, 255, 255, 0.4);
  animation: borderPulse 2s infinite;
}
.content { white-space: pre-wrap; }
.path-action {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
}
.path-save-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(37, 99, 235, 0.22);
  border-radius: 8px;
  background: rgba(37, 99, 235, 0.06);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}
.path-save-btn:hover:not(:disabled) {
  background: rgba(37, 99, 235, 0.11);
}
.workflow-save-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(16, 185, 129, 0.24);
  border-radius: 8px;
  background: rgba(16, 185, 129, 0.08);
  color: #047857;
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}
.workflow-save-btn:hover:not(:disabled) {
  background: rgba(16, 185, 129, 0.14);
}
.workflow-open-btn {
  height: 32px;
  padding: 0 12px;
  border: 1px solid rgba(15, 23, 42, 0.12);
  border-radius: 8px;
  background: rgba(15, 23, 42, 0.05);
  color: var(--text-primary);
  font-size: 12px;
  font-weight: 900;
  cursor: pointer;
}
.workflow-open-btn:hover {
  background: rgba(15, 23, 42, 0.09);
}
.path-save-btn:disabled,
.workflow-save-btn:disabled {
  cursor: default;
  opacity: 0.72;
}
.path-save-error {
  color: #dc2626;
  font-size: 12px;
  font-weight: 800;
}
.tool-calls-container {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}
.think-card {
  background: rgba(124, 58, 237, 0.04);
  border: 1px solid rgba(124, 58, 237, 0.12);
  border-radius: 16px;
  overflow: hidden;
  margin-bottom: 12px;
}
.think-card.collapsed .think-content { display: none; }
.think-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 14px;
  border: none;
  background: transparent;
  color: #7c3aed;
  font-size: 12px;
  font-weight: 900;
  text-transform: uppercase;
  letter-spacing: 0.1em;
  cursor: pointer;
  transition: background 0.2s;
}
.think-toggle:hover { background: rgba(124, 58, 237, 0.06); }
.think-toggle svg { flex-shrink: 0; transition: transform 0.2s; }
.think-content {
  padding: 0 14px 14px;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary);
  font-weight: 600;
  white-space: pre-wrap;
  max-height: 400px;
  overflow-y: auto;
  opacity: 0.8;
}
.typing { display: flex; gap: 8px; align-items: center; padding: 16px 4px; }
.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #10b981;
  opacity: 0.6;
  animation: typing 1.2s infinite both;
}
.dot:nth-child(2) { animation-delay: 0.2s; }
.dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes borderPulse {
  0%, 100% { border-color: rgba(16, 185, 129, 0.2); }
  50% { border-color: rgba(16, 185, 129, 0.8); }
}
@keyframes typing {
  0%, 80%, 100% { opacity: 0.2; transform: translateY(0); }
  40% { opacity: 1; transform: translateY(-6px); }
}
</style>
