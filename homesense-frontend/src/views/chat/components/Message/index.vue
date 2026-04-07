<script setup lang='ts'>
import { computed, ref } from 'vue'
import { NDropdown, useMessage } from 'naive-ui'
import AvatarComponent from './Avatar.vue'
import TextComponent from './Text.vue'
import { SvgIcon } from '@/components/common'
import { useIconRender } from '@/hooks/useIconRender'
import { t } from '@/locales'
import { useBasicLayout } from '@/hooks/useBasicLayout'
import { copyToClip } from '@/utils/copy'

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

interface Props {
  dateTime?: string
  text?: string
  inversion?: boolean
  error?: boolean
  loading?: boolean
  trace?: StageTraceEntry[]
  writeBackResults?: WriteBackResult[]
  llm?: LlmData
  skillsHint?: string[]
}

interface Emit {
  (ev: 'regenerate'): void
  (ev: 'delete'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emit>()

const { isMobile } = useBasicLayout()
const { iconRender } = useIconRender()
const message = useMessage()

const asRawText = ref(props.inversion)
const messageRef = ref<HTMLElement>()
const showDebug = ref(false)

const hasDebugInfo = computed(() => {
  return (props.trace?.length || 0) > 0 || (props.writeBackResults?.length || 0) > 0 || Boolean(props.llm) || (props.skillsHint?.length || 0) > 0
})
const debugSummary = computed(() => (props.trace || []).map(item => item.stage).join(' → '))

const options = computed(() => {
  const common = [
    {
      label: t('chat.copy'),
      key: 'copyText',
      icon: iconRender({ icon: 'ri:file-copy-2-line' }),
    },
    {
      label: t('common.delete'),
      key: 'delete',
      icon: iconRender({ icon: 'ri:delete-bin-line' }),
    },
  ]

  if (!props.inversion) {
    common.unshift({
      label: asRawText.value ? t('chat.preview') : t('chat.showRawText'),
      key: 'toggleRenderType',
      icon: iconRender({ icon: asRawText.value ? 'ic:outline-code-off' : 'ic:outline-code' }),
    })
  }

  return common
})

function formatWriteBack(result: WriteBackResult) {
  if (result.type === 'success_path') {
    return result.successState === false
      ? `已记录失败经验：${result.pathName || 'unknown'}`
      : `已记录成功经验：${result.pathName || 'unknown'}`
  }
  return result.message || result.type
}

function formatSuggestedAction(action: { tool: string, action: string }) {
  return `${action.tool}.${action.action}`
}

function formatSkillRef(skill: string) {
  return skill
}

function formatSkillInsight(insight: { tool: string, section: string, headline?: string }) {
  return insight.headline || `${insight.tool}/${insight.section}`
}

const selectedSkillRefs = computed(() => {
  return props.llm?.selected_skills || props.llm?.selected_skill_refs || []
})

const selectedSkillSummary = computed(() => {
  return props.llm?.context_summary?.selectedSkills || []
})

const stageSkillHints = computed(() => {
  return props.skillsHint || []
})

function handleSelect(key: 'copyText' | 'delete' | 'toggleRenderType') {
  switch (key) {
    case 'copyText':
      handleCopy()
      return
    case 'toggleRenderType':
      asRawText.value = !asRawText.value
      return
    case 'delete':
      emit('delete')
  }
}

function handleRegenerate() {
  messageRef.value?.scrollIntoView()
  emit('regenerate')
}

async function handleCopy() {
  try {
    await copyToClip(props.text || '')
    message.success(t('chat.copied'))
  }
  catch {
    message.error(t('chat.copyFailed'))
  }
}
</script>

<template>
  <div
    ref="messageRef"
    class="flex w-full mb-6 overflow-hidden"
    :class="[{ 'flex-row-reverse': inversion }]"
  >
    <div
      class="flex items-center justify-center flex-shrink-0 h-8 overflow-hidden rounded-full basis-8"
      :class="[inversion ? 'ml-2' : 'mr-2']"
    >
      <AvatarComponent :image="inversion" />
    </div>
    <div class="overflow-hidden text-sm" :class="[inversion ? 'items-end' : 'items-start']">
      <p class="text-xs text-[#b4bbc4]" :class="[inversion ? 'text-right' : 'text-left']">
        {{ dateTime }}
      </p>
      <div
        class="flex items-end gap-1 mt-2"
        :class="[inversion ? 'flex-row-reverse' : 'flex-row']"
      >
        <div>
          <TextComponent
            :inversion="inversion"
            :error="error"
            :text="text"
            :loading="loading"
            :as-raw-text="asRawText"
          />

          <div
            v-if="!inversion && hasDebugInfo"
            class="mt-2 rounded-md border border-[#e5e7eb] bg-white/70 p-2 text-xs text-[#4b5563] dark:border-[#2a2a2d] dark:bg-[#151518] dark:text-[#c7c9d1]"
          >
            <button class="flex w-full items-center justify-between" @click="showDebug = !showDebug">
              <span>{{ debugSummary || '执行信息' }}</span>
              <SvgIcon :icon="showDebug ? 'ri:arrow-up-s-line' : 'ri:arrow-down-s-line'" />
            </button>

            <div v-if="showDebug" class="mt-2 space-y-2">
              <div v-if="trace?.length">
                <div class="mb-1 font-medium">处理路径</div>
                <div
                  v-for="(item, index) in trace"
                  :key="`${item.stage}-${index}`"
                  class="mb-1 rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]"
                >
                  <div>
                    <span class="font-medium">{{ item.stage }}</span>
                    <span class="ml-2">{{ item.ok ? '成功' : '未命中/失败' }}</span>
                    <span class="ml-2 text-[#9ca3af]">→ {{ item.next }}</span>
                  </div>
                  <div v-if="item.reason" class="text-[#9ca3af]">{{ item.reason }}</div>
                </div>
              </div>

              <div v-if="llm">
                <div class="mb-1 font-medium">Deep Layer 规划</div>
                <div class="rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
                  <div v-if="llm.intent_hint">意图提示：{{ llm.intent_hint }}</div>
                  <div v-if="llm.next_hint">下一步建议：{{ llm.next_hint }}</div>
                  <div v-if="llm.needs_model_config">模型状态：待配置</div>
                </div>
                <div v-if="stageSkillHints.length" class="mt-1 rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
                  <div class="font-medium mb-1">Stage Skills Hint</div>
                  <div v-for="(skill, index) in stageSkillHints" :key="`stage-${skill}-${index}`">
                    {{ formatSkillRef(skill) }}
                  </div>
                </div>
                <div v-if="selectedSkillRefs.length" class="mt-1 rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
                  <div class="font-medium mb-1">已加载 Skills</div>
                  <div v-for="(skill, index) in selectedSkillRefs" :key="`${skill}-${index}`">
                    {{ formatSkillRef(skill) }}
                  </div>
                </div>
                <div v-if="selectedSkillSummary.length" class="mt-1 rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
                  <div class="font-medium mb-1">Skills 摘要</div>
                  <div v-for="(skill, index) in selectedSkillSummary" :key="`${skill.tool}-${skill.section}-${index}`">
                    {{ skill.tool }}/{{ skill.section }}
                  </div>
                </div>
                <div v-if="llm.skill_insights?.length" class="mt-1 rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
                  <div class="font-medium mb-1">Skills 洞察</div>
                  <div v-for="(insight, index) in llm.skill_insights" :key="`${insight.tool}-${insight.section}-${index}`">
                    {{ formatSkillInsight(insight) }}
                  </div>
                </div>
                <div v-if="llm.plan?.length" class="mt-1 rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
                  <div class="font-medium mb-1">规划步骤</div>
                  <div v-for="(step, index) in llm.plan" :key="`${step}-${index}`">{{ index + 1 }}. {{ step }}</div>
                </div>
                <div v-if="llm.suggested_actions?.length" class="mt-1 rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]">
                  <div class="font-medium mb-1">建议动作</div>
                  <div v-for="(action, index) in llm.suggested_actions" :key="`${action.tool}-${action.action}-${index}`">
                    {{ formatSuggestedAction(action) }}
                  </div>
                </div>
              </div>

              <div v-if="writeBackResults?.length">
                <div class="mb-1 font-medium">经验写回</div>
                <div
                  v-for="(item, index) in writeBackResults"
                  :key="`${item.type}-${index}`"
                  class="mb-1 rounded bg-[#f6f8fa] px-2 py-1 dark:bg-[#1d1f23]"
                >
                  {{ formatWriteBack(item) }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="flex flex-col">
          <button
            v-if="!inversion"
            class="mb-2 transition text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-300"
            @click="handleRegenerate"
          >
            <SvgIcon icon="ri:restart-line" />
          </button>
          <NDropdown
            :trigger="isMobile ? 'click' : 'hover'"
            :placement="!inversion ? 'right' : 'left'"
            :options="options"
            @select="handleSelect"
          >
            <button class="transition text-neutral-300 hover:text-neutral-800 dark:hover:text-neutral-200">
              <SvgIcon icon="ri:more-2-fill" />
            </button>
          </NDropdown>
        </div>
      </div>
    </div>
  </div>
</template>
