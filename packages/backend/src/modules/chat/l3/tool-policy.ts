import { shouldAttemptL1Reflex } from '../../command/l1-reflex-policy.js'
import type { RuntimeContextWindow } from '../../runtime/index.js'

export type L3ToolPolicyKind = 'none' | 'read_only' | 'preview_only' | 'execute_allowed'

export interface L3ToolPolicy {
  kind: L3ToolPolicyKind
  reason: string
  l1_reflex_allowed: boolean
}

type AgentToolDefinition = {
  type: 'function'
  function: {
    name: string
    [key: string]: unknown
  }
}

const READ_ONLY_TOOLS = new Set([
  'list_user_devices',
  'get_device_capabilities',
  'get_device_type_skill',
  'list_device_apps',
  'get_current_app',
  'take_screenshot',
  'get_ui_tree',
  'understand_screen',
  'list_workflows',
])

const PREVIEW_TOOLS = new Set([
  'rehearse_device_capability',
  'preview_workflow',
])

const DEVICE_WORDS = ['设备', '电视', '机顶盒', '盒子', '音箱', '小爱', '空调', '灯', '插座', '手机', '平板', '电脑', '遥控']
const WORKFLOW_WORDS = ['工作流', '流程', '自动化', '执行清单', '路径', '场景', '模式', '例程']
const ACTION_WORDS = ['打开', '关闭', '开', '关', '播放', '暂停', '继续', '看', '听', '放', '音量', '大声', '小声', '返回', '主页', '确认', '确定', '上', '下', '左', '右', '运行', '执行', '启动']
const QUERY_WORDS = ['状态', '现在', '当前', '是不是', '有没有', '在哪', '谁在', '在线', '离线']
const EXPLAIN_WORDS = ['怎么', '如何', '为什么', '什么', '了解', '解释', '咨询', '讨论', '只是', '确认一下']
const MULTI_STEP_WORDS = ['然后', '再', '接着', '同时', '并且', '以及', '顺便']

export function classifyL3ToolPolicy(input: string, context?: RuntimeContextWindow): L3ToolPolicy {
  const text = input.trim()
  const compact = text.replace(/\s+/g, '')
  if (!compact) return none('empty input')

  const hasActiveDevice = Boolean(context?.working_context.current_device)
  const mentionsDevice = DEVICE_WORDS.some((word) => text.includes(word))
  const mentionsWorkflow = WORKFLOW_WORDS.some((word) => text.includes(word))
  const mentionsAction = ACTION_WORDS.some((word) => text.includes(word))
  const mentionsQuery = QUERY_WORDS.some((word) => text.includes(word))
  const explains = EXPLAIN_WORDS.some((word) => text.includes(word))
  const multiStep = MULTI_STEP_WORDS.some((word) => text.includes(word)) || /[，,；;、]/.test(text)
  const noExecution = hasExplicitNoExecutionIntent(text)
  const question = /[?？]/.test(text)
  const l1Gate = shouldAttemptL1Reflex(input)
  const directReflexCandidate = l1Gate.allowed && (mentionsDevice || hasActiveDevice)

  if (isPureGreeting(text)) {
    return none('pure greeting')
  }

  if (/(记住|记一下|我喜欢|我不喜欢|偏好|习惯)/.test(text)) {
    return execute('memory write requested', false)
  }

  if (/(提醒我|定时|倒计时|分钟后|小时后|稍后|待会|等下)/.test(text)) {
    return execute('timer or delayed action requested', false)
  }

  if ((noExecution || question || explains || mentionsQuery) && (mentionsDevice || mentionsAction || mentionsWorkflow || hasActiveDevice)) {
    return readOnly(noExecution ? 'user explicitly blocked execution' : 'question or inspection intent')
  }

  if (mentionsWorkflow) {
    return preview('workflow requests must preview before running')
  }

  if (multiStep && (mentionsDevice || mentionsAction || hasActiveDevice)) {
    return preview('multi-step device request must preview before execution')
  }

  if (directReflexCandidate) {
    return execute('short imperative command', true)
  }

  if (mentionsDevice || (mentionsAction && hasActiveDevice)) {
    return readOnly('device-related utterance is not a direct command')
  }

  return none('no tool-worthy intent')
}

export function fallbackToolPolicy(allowTools: boolean | undefined): L3ToolPolicy {
  return allowTools ? execute('legacy allow_tools fallback', false) : none('legacy no-tools fallback')
}

export function filterToolDefinitionsForPolicy<T extends AgentToolDefinition>(
  tools: T[],
  policy: L3ToolPolicyKind,
): T[] {
  return tools.filter((tool) => isToolAllowedByPolicy(tool.function.name, policy))
}

export function isToolAllowedByPolicy(toolName: string, policy: L3ToolPolicyKind): boolean {
  if (policy === 'none') return false
  if (policy === 'read_only') return READ_ONLY_TOOLS.has(toolName)
  if (policy === 'preview_only') return READ_ONLY_TOOLS.has(toolName) || PREVIEW_TOOLS.has(toolName)
  return true
}

export function describeToolPolicy(policy: L3ToolPolicyKind): string {
  if (policy === 'none') return 'No tools are available this turn.'
  if (policy === 'read_only') return 'Only read-only device and workflow discovery tools are available. Do not execute, rehearse, run workflows, write memory, or set timers.'
  if (policy === 'preview_only') return 'Read-only tools plus rehearsal/preview tools are available. Do not call execute_device_capability or run_workflow.'
  return 'Execution tools are available for clear direct commands. Rehearse uncertain device actions before real execution.'
}

export function allowedToolNamesForPolicy(policy: L3ToolPolicyKind): string[] {
  if (policy === 'none') return []
  if (policy === 'read_only') return Array.from(READ_ONLY_TOOLS)
  if (policy === 'preview_only') return [...Array.from(READ_ONLY_TOOLS), ...Array.from(PREVIEW_TOOLS)]
  return ['*']
}

function none(reason: string): L3ToolPolicy {
  return { kind: 'none', reason, l1_reflex_allowed: false }
}

function readOnly(reason: string): L3ToolPolicy {
  return { kind: 'read_only', reason, l1_reflex_allowed: false }
}

function preview(reason: string): L3ToolPolicy {
  return { kind: 'preview_only', reason, l1_reflex_allowed: false }
}

function execute(reason: string, l1ReflexAllowed: boolean): L3ToolPolicy {
  return { kind: 'execute_allowed', reason, l1_reflex_allowed: l1ReflexAllowed }
}

function hasExplicitNoExecutionIntent(text: string): boolean {
  return [
    /(?:先别|别|不要|不需要|不用|先不).{0,6}(?:执行|操作|运行|打开|关闭|控制|动)/,
    /不(?:要|用|需要).{0,6}真的.{0,6}(?:执行|操作|运行|打开|关闭|控制|动)/,
    /只是?.{0,8}(?:了解|确认|看看|问|咨询|知道|学习)/,
  ].some((pattern) => pattern.test(text))
}

function isPureGreeting(text: string): boolean {
  return /^(你好|您好|hello|hi|嗨|在吗|你在吗|hey|早上好|晚上好|晚安)[!！。？?\s]*$/i.test(text)
}
