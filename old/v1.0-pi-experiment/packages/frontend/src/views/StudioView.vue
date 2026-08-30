<script setup lang="ts">
import { ref, computed, markRaw, onMounted, onUnmounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useVueFlow } from '@vue-flow/core'
import type { Connection } from '@vue-flow/core'
import WorkflowNodeVue from '../components/WorkflowNode.vue'
import WorkflowRunner from '../components/WorkflowRunner.vue'
import PlanPreviewCard from '../components/PlanPreviewCard.vue'
import ManifestExplorer from '../components/ManifestExplorer.vue'
import ObservabilityPanel from '../components/ObservabilityPanel.vue'
import NodeInspector from '../components/studio/NodeInspector.vue'
import WorkflowSidebar from '../components/studio/WorkflowSidebar.vue'
import CanvasArea from '../components/studio/CanvasArea.vue'
import { useWorkflow } from '../composables/useWorkflow'
import { useLocale } from '../composables/useLocale'
import { buildNodeLibrarySections, buildWorkflowHeaderChips } from '../features/studio/studioEditorChrome'
import {
  formatNodeCategory,
  formatNodeDescription,
  formatNodeFieldLabel,
  formatNodeLabel,
} from '../features/studio/studioNodeDisplay'
import {
  buildWorkflowCollectionMetrics,
  buildWorkflowEditorSummaryItems,
  buildWorkflowSectionHeading,
} from '../features/studio/studioWorkflowDensity'
import {
  formatBindingKind,
  formatCapability,
  formatExecutionMode,
  formatShowcaseBadge,
  formatShowcaseEyebrow,
  formatVariableMode,
  formatVariableSource,
} from '../features/studio/studioViewDisplay'
import {
  formatAgentAdapterCategory,
  formatAgentAdapterMode,
  formatAgentAdapterStatus,
  formatAgentAdapterTransport,
  formatCliExecutorProtocol,
  formatCliExecutorSource,
  formatExecutorKind,
} from '../features/studio/studioExecutorDisplay'
import { buildStudioInspectorCopy } from '../features/studio/studioInspectorCopy'
import { buildWorkflowRoute, parseWorkflowRouteId, replaceWorkflowRouteId } from '../features/studio/workflowEditorRoute'
import { buildWorkflowRunExperiencePayload } from '../features/studio/workflowRunMemory'
import { buildWorkflowRunPresets, type WorkflowRunPreset } from '../features/studio/workflowRunPresets'
import { buildWorkflowPublishEvidence, filterWorkflowRunsForGraph } from '../features/studio/workflowPublishEvidence'
import { api, type DeviceRuntimeManifestCapabilitySummary, type DeviceRuntimeManifestItem } from '../api'
import { executorApi } from '../api/executor'
import { memoryAssetsApi } from '../api/memoryAssets'
import type { AgentAdapterDescriptor, CLIExecutorDescriptor, ExecutorDescriptor } from '../api/executor'
import { workflowApi, type Workflow, type WorkflowEdgeData, type WorkflowNodeConfigField, type WorkflowPreviewResult, type WorkflowRun, type WorkflowRunResult } from '../api/workflow'

const route = useRoute()
const router = useRouter()

const EXECUTOR_PRESETS: Record<string, Partial<ExecutorDescriptor>> = {
  'agent.dispatch': {
    description: 'Dispatch a structured runtime task to a registered local capability adapter.',
    enabled: true,
    capabilities: ['device', 'adapter', 'dry_run'],
    metadata: {
      mode: 'dry_run',
      supported_targets: ['mi_adb', 'bilibili_cli', 'openclaw'],
      param_template: {
        target: 'mi_adb',
        task: 'Inspect target device runtime before execution.',
        payload: { action: 'list_packages', keyword: 'bili' },
        execution_mode: 'immediate',
      },
    },
  },
  'cli.invoke': {
    metadata: {
      transport: 'local_cli_bridge',
      param_template: {
        cli_name: 'adb-cli',
        action: 'list_packages',
        params: {},
      },
    },
  },
  'service.invoke': {
    metadata: {
      transport: 'in_process_service',
      param_template: {
        service_name: '',
        params: {},
      },
    },
  },
  'workflow.run': {
    metadata: {
      transport: 'workflow_runtime',
      param_template: {
        workflow_id: 1,
        inputs: {},
      },
    },
  },
  'plan.run': {
    metadata: {
      transport: 'compiled_plan_runtime',
      param_template: {
        plan_id: 'path_demo_watch_bilibili',
      },
    },
  },
}

const AGENT_ADAPTER_PRESETS: Record<string, Partial<AgentAdapterDescriptor>> = {
  bilibili_cli: {
    status: 'ready',
    input_schema: {
      task: 'string',
      payload: 'object',
      execution_mode: ['deferred'],
    },
    sample_dispatch: {
      task: 'Prepare a Bilibili upload draft for a HomeSense demo video.',
      payload: {
        title: 'HomeSense Studio demo',
        source_path: './exports/homesense-demo.mp4',
        tags: ['HomeSense', 'Smart Home', 'Workflow'],
        visibility: 'private',
        dry_run: true,
      },
      execution_mode: 'deferred',
    },
  },
  claude_code: {
    status: 'planned',
    input_schema: {
      task: 'string',
      payload: 'object',
      execution_mode: ['deferred'],
    },
    sample_dispatch: {
      task: 'Refine workflow runtime UX and summarize the delta.',
      payload: { scope: 'frontend' },
      execution_mode: 'deferred',
    },
  },
  codex: {
    status: 'ready',
    input_schema: {
      task: 'string',
      payload: 'object',
      execution_mode: ['deferred', 'immediate'],
    },
    sample_dispatch: {
      task: 'Review the current repository and propose a minimal patch plan.',
      payload: { focus: ['architecture', 'tests'] },
      execution_mode: 'deferred',
    },
  },
  mi_adb: {
    status: 'ready',
    input_schema: {
      task: 'string',
      payload: 'object',
      execution_mode: ['deferred', 'immediate'],
    },
    sample_dispatch: {
      task: 'Launch the Bilibili TV app on the target device.',
      payload: { package: 'com.xiaodianshi.tv.yst' },
      execution_mode: 'immediate',
    },
  },
  openclaw: {
    status: 'planned',
    input_schema: {
      task: 'string',
      payload: 'object',
      execution_mode: ['deferred', 'immediate'],
    },
    sample_dispatch: {
      task: 'Open a desktop app and complete a scripted operator flow.',
      payload: { app: 'browser', checkpoints: 3 },
      execution_mode: 'immediate',
    },
  },
}
const { t, locale } = useLocale()
const routeWorkflowId = computed(() => parseWorkflowRouteId(route.params.id as string | string[] | undefined))
const workflowsLoaded = ref(false)
const isZh = computed(() => locale.value === 'zh')

type WorkflowShowcaseLane = 'home' | 'studio' | 'memory'

type WorkflowShowcaseCard = Workflow & {
  lane: WorkflowShowcaseLane
  badge: string
  eyebrow: string
  priority: number
}

const WORKFLOW_SHOWCASE: Record<string, Omit<WorkflowShowcaseCard, keyof Workflow>> = {
  'Device Capability Rehearsal Demo': {
    lane: 'home',
    badge: 'Capability',
    eyebrow: 'Sandbox Rehearsal',
    priority: 0,
  },
  'Watch Bilibili On Toshiba TV Demo': {
    lane: 'home',
    badge: 'Hero',
    eyebrow: 'Family Entertainment',
    priority: 1,
  },
  'Bilibili Media Dispatch Demo': {
    lane: 'studio',
    badge: 'Adapter',
    eyebrow: 'Local Capability',
    priority: 4,
  },
  'DLNA Cast Demo': {
    lane: 'studio',
    badge: 'DLNA',
    eyebrow: 'Casting',
    priority: 2,
  },
  'Speaker Cast Demo': {
    lane: 'studio',
    badge: 'Speaker',
    eyebrow: 'Casting',
    priority: 3,
  },
  'Bilibili Subflow Demo': {
    lane: 'studio',
    badge: 'Subflow',
    eyebrow: 'Reusable Runtime',
    priority: 5,
  },
  'Candidate Plan Routing Demo': {
    lane: 'memory',
    badge: 'Memory',
    eyebrow: 'Candidate Routing',
    priority: 6,
  },
}

const {
  workflows,
  currentWorkflow,
  nodes: workflowNodes,
  edges: workflowEdges,
  isDirty,
  nodeTypes,
  loadNodeDefinitions,
  loadWorkflows,
  loadWorkflow,
  createWorkflow,
  reseedDefaults,
  saveWorkflow,
  setWorkflowPublished,
  runWorkflow,
  previewWorkflow,
  deleteWorkflow,
  addNode,
  updateNodeConfig,
  removeNode,
  addEdge,
} = useWorkflow()

const selectedNodeIndex = ref<number | null>(null)
const showObs = ref(false)
const latestRun = ref<WorkflowRunResult | null>(null)
const latestPreview = ref<WorkflowPreviewResult | null>(null)
const workflowRunHistory = ref<WorkflowRun[]>([])
const workflowRunPresets = ref<WorkflowRunPreset[]>([])
const workflowRunMemoryStatus = ref<Record<number, 'saving' | 'saved' | 'error'>>({})
const workflowRunMemoryErrors = ref<Record<number, string>>({})
const activeRunId = ref<number | null>(null)
const availablePlans = ref<Array<Record<string, unknown>>>([])
const availableExecutors = ref<ExecutorDescriptor[]>([])
const availableAgentAdapters = ref<AgentAdapterDescriptor[]>([])
const availableCLIExecutors = ref<CLIExecutorDescriptor[]>([])
const runtimeDeviceManifest = ref<DeviceRuntimeManifestItem[]>([])
const runtimeDeviceManifestLoading = ref(false)
const selectedRunDeviceId = ref<number | null>(null)
const selectedRunCapabilityId = ref('')
const selectedVariableTarget = ref('')
const executorParamsText = ref('{}')
const runInputsText = ref('{}')
const runInputError = ref('')

const { onConnect, project, vueFlowRef } = useVueFlow()

const nodeTypesMap: Record<string, any> = {
  custom: markRaw(WorkflowNodeVue),
}

const previewStepByNodeId = computed(() => {
  const map = new Map<string, WorkflowPreviewResult['steps'][number]>()
  for (const step of latestPreview.value?.steps ?? []) {
    map.set(String(step.node_id), step)
  }
  return map
})

function resolvePreviewEdgeState(edge: WorkflowEdgeData): 'active' | 'skipped' | 'blocked' | 'idle' {
  const sourceStep = previewStepByNodeId.value.get(String(edge.source_node_id))
  const targetStep = previewStepByNodeId.value.get(String(edge.target_node_id))
  if (!sourceStep || !targetStep) return 'idle'

  const sourcePort = edge.source_port ?? 'out'
  const isActivePort = sourceStep.active_outputs.includes(sourcePort)

  if (sourceStep.preview_state === 'blocked' || targetStep.preview_state === 'blocked') {
    return isActivePort ? 'blocked' : 'idle'
  }
  if (sourceStep.preview_state === 'skipped' || targetStep.preview_state === 'skipped') {
    return 'skipped'
  }
  if (sourceStep.preview_state === 'ready' && targetStep.preview_state === 'ready' && isActivePort) {
    return 'active'
  }
  return 'idle'
}

function previewEdgeStyle(state: 'active' | 'skipped' | 'blocked' | 'idle') {
  if (state === 'active') {
    return { stroke: 'var(--primary-color)', strokeWidth: 2.6 }
  }
  if (state === 'blocked') {
    return { stroke: '#b42318', strokeWidth: 2.2, strokeDasharray: '6 4' }
  }
  if (state === 'skipped') {
    return { stroke: '#b6bdc6', strokeWidth: 1.4, strokeDasharray: '4 4', opacity: 0.72 }
  }
  return { stroke: '#8f8f8f', strokeWidth: 1.6 }
}

const flowNodes = computed(() =>
  workflowNodes.value.map((node, index) => {
    const trace = latestRun.value?.trace.find((item) => Number(item.node_id) === Number(node.id))
    const previewStep = node.id != null ? previewStepByNodeId.value.get(String(node.id)) : undefined
    return {
      id: `node_${index}`,
      type: 'custom',
      position: node.position,
      data: {
        type: node.type,
        label: node.label,
        config: node.config,
        status: trace?.status === 'skipped' ? 'idle' : trace?.status,
        previewRisk: previewStep?.risk,
        previewState: previewStep?.preview_state,
      },
    }
  }),
)

const nodeIdToFlowIndex = computed(() => {
  const map = new Map<number, number>()
  workflowNodes.value.forEach((node, index) => {
    if (node.id != null) {
      map.set(Number(node.id), index)
    }
  })
  return map
})

const activeStepNodeIds = ref<Set<string>>(new Set())

const flowEdges = computed(() =>
  workflowEdges.value
    .map((edge, index) => {
      const sourceIndex = nodeIdToFlowIndex.value.get(Number(edge.source_node_id)) ?? Number(edge.source_node_id)
      const targetIndex = nodeIdToFlowIndex.value.get(Number(edge.target_node_id)) ?? Number(edge.target_node_id)
      const edgeState = resolvePreviewEdgeState(edge)
      const sourcePort = edge.source_port ?? 'out'

      const isExecuting = activeStepNodeIds.value.has(String(edge.source_node_id)) && activeRunId.value != null

      return {
        id: `edge_${index}`,
        source: `node_${sourceIndex}`,
        target: `node_${targetIndex}`,
        sourceHandle: sourcePort,
        targetHandle: edge.target_port ?? 'in',
        animated: edgeState === 'active' || isExecuting,
        style: isExecuting
          ? { stroke: 'var(--primary-color)', strokeWidth: 3, opacity: 1 }
          : previewEdgeStyle(edgeState),
        label: sourcePort === 'true' || sourcePort === 'false' ? sourcePort : undefined,
        labelStyle: sourcePort === 'true'
          ? { fill: 'var(--primary-color)', fontWeight: 700, fontSize: 11 }
          : sourcePort === 'false'
            ? { fill: '#8a5a00', fontWeight: 700, fontSize: 11 }
            : undefined,
      }
    })
    .filter((edge) => workflowNodes.value[Number(edge.source.replace('node_', ''))] && workflowNodes.value[Number(edge.target.replace('node_', ''))]),
)

const selectedNode = computed(() => {
  if (selectedNodeIndex.value == null) return null
  return workflowNodes.value[selectedNodeIndex.value] ?? null
})

const selectedNodeDefinition = computed(() => {
  if (!selectedNode.value) return null
  return nodeTypes.value.find((nodeType) => nodeType.type === selectedNode.value?.type) ?? null
})

const selectedConfigFields = computed(() => selectedNodeDefinition.value?.config_schema ?? [])
const selectedOutputFields = computed(() => selectedNodeDefinition.value?.output_schema ?? [])

const selectedNodeTrace = computed(() => {
  if (!latestRun.value || !selectedNode.value?.id) return null
  return latestRun.value.trace.find((trace) => String(trace.node_id) === String(selectedNode.value?.id)) ?? null
})

function edgeRefToNodeIndex(ref: number): number | null {
  const mapped = nodeIdToFlowIndex.value.get(Number(ref))
  if (mapped != null) return mapped
  return Number.isInteger(ref) && ref >= 0 && ref < workflowNodes.value.length ? ref : null
}

const selectedNodeAncestorIndices = computed(() => {
  if (selectedNodeIndex.value == null) return []

  const visited = new Set<number>()
  const stack = [selectedNodeIndex.value]

  while (stack.length > 0) {
    const targetIndex = stack.pop()!
    for (const edge of workflowEdges.value) {
      const resolvedTargetIndex = edgeRefToNodeIndex(Number(edge.target_node_id))
      if (resolvedTargetIndex !== targetIndex) continue

      const sourceIndex = edgeRefToNodeIndex(Number(edge.source_node_id))
      if (sourceIndex == null || visited.has(sourceIndex)) continue
      visited.add(sourceIndex)
      stack.push(sourceIndex)
    }
  }

  return Array.from(visited).sort((left, right) => left - right)
})

const availableVariableBindings = computed(() => {
  const bindings: Array<{ key: string; label: string; template: string; source: string }> = []
  const seen = new Set<string>()

  for (const node of workflowNodes.value.filter((item) => item.type === 'start')) {
    const inputs = node.config.inputs
    if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) continue
    for (const key of Object.keys(inputs as Record<string, unknown>)) {
      const template = `{{input.${key}}}`
      if (seen.has(template)) continue
      seen.add(template)
      bindings.push({
        key: `input.${key}`,
        label: `input.${key}`,
        template,
        source: 'workflow input',
      })
    }
  }

  for (const index of selectedNodeAncestorIndices.value) {
    const node = workflowNodes.value[index]
    if (!node || node.id == null) continue
    const definition = nodeTypes.value.find((item) => item.type === node.type)
    for (const output of definition?.output_schema ?? []) {
      const variableKey = `node.${node.id}.${output.key}`
      const template = `{{${variableKey}}}`
      if (seen.has(template)) continue
      seen.add(template)
      bindings.push({
        key: variableKey,
        label: `${node.label || node.type}.${output.key}`,
        template,
        source: node.type,
      })
    }
  }

  return bindings
})

const hasUnsavedVariableSources = computed(() =>
  selectedNodeAncestorIndices.value.some((index) => workflowNodes.value[index] && workflowNodes.value[index].id == null),
)

const variableFieldTargets = computed(() => {
  const targets: Array<{ id: string; label: string; mode: 'text' | 'json' }> = []

  if (!selectedNode.value) return targets

  if (selectedNode.value.type === 'answer') {
    targets.push({ id: 'config:message', label: label('回答内容', 'Answer'), mode: 'text' })
  } else if (selectedNode.value.type === 'subflow') {
    targets.push({ id: 'config:workflow_name', label: label('目标工作流名称', 'Target Workflow Name'), mode: 'text' })
    targets.push({ id: 'config:output_key', label: label('输出键', 'Output Key'), mode: 'text' })
    targets.push({ id: 'config:inputs', label: label('子流程输入', 'Subflow Inputs'), mode: 'json' })
  } else if (selectedNode.value.type === 'executor_call') {
    if (selectedExecutorName.value === 'agent.dispatch') {
      targets.push({ id: 'executor:task', label: label('能力任务', 'Capability Task'), mode: 'text' })
      targets.push({ id: 'executor:payload', label: label('能力载荷', 'Capability Payload'), mode: 'json' })
    } else if (selectedExecutorName.value === 'cli.invoke') {
      targets.push({ id: 'executor:params', label: label('CLI 动作参数', 'CLI Action Params'), mode: 'json' })
    } else if (selectedExecutorName.value === 'workflow.run') {
      targets.push({ id: 'executor:inputs', label: label('工作流输入', 'Workflow Inputs'), mode: 'json' })
    } else if (selectedExecutorName.value === 'service.invoke') {
      targets.push({ id: 'executor:service_params', label: label('服务参数', 'Service Params'), mode: 'json' })
    }
  } else {
    for (const field of selectedConfigFields.value) {
      if (field.control === 'text' || field.control === 'textarea') {
        targets.push({ id: `config:${field.key}`, label: field.label, mode: 'text' })
      }
      if (field.control === 'json') {
        targets.push({ id: `config:${field.key}`, label: field.label, mode: 'json' })
      }
    }
  }

  return targets
})

function getVariableTargetValue(targetId: string): string {
  if (!selectedNode.value) return ''
  if (targetId.startsWith('config:')) {
    const key = targetId.slice('config:'.length)
    const value = selectedNode.value.config[key]
    return typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2)
  }
  if (targetId === 'executor:task') {
    const value = selectedExecutorParams.value.task
    return value == null ? '' : String(value)
  }
  if (targetId === 'executor:payload') {
    return JSON.stringify(selectedExecutorParams.value.payload ?? {}, null, 2)
  }
  if (targetId === 'executor:params') {
    return JSON.stringify(selectedExecutorParams.value.params ?? {}, null, 2)
  }
  if (targetId === 'executor:inputs') {
    return JSON.stringify(selectedExecutorParams.value.inputs ?? {}, null, 2)
  }
  if (targetId === 'executor:service_params') {
    return JSON.stringify(selectedExecutorParams.value.params ?? {}, null, 2)
  }
  return ''
}

function setVariableTargetValue(targetId: string, value: string) {
  if (!selectedNode.value) return
  if (targetId.startsWith('config:')) {
    const key = targetId.slice('config:'.length)
    const field = selectedConfigFields.value.find((item) => item.key === key)
    if (field?.control === 'json') {
      try {
        handleUpdateConfig(key, JSON.parse(value || '{}'))
      } catch {
        return
      }
    } else {
      handleUpdateConfig(key, value)
    }
    return
  }
  if (targetId === 'executor:task') {
    updateExecutorParam('task', value)
    return
  }
  if (targetId === 'executor:payload') {
    updateExecutorObjectParam('payload', value)
    return
  }
  if (targetId === 'executor:params') {
    updateExecutorObjectParam('params', value)
    return
  }
  if (targetId === 'executor:inputs') {
    updateExecutorObjectParam('inputs', value)
    return
  }
  if (targetId === 'executor:service_params') {
    updateExecutorObjectParam('params', value)
  }
}

function insertVariableTemplate(targetId: string, template: string) {
  const current = getVariableTargetValue(targetId)
  const nextValue = current
    ? /\s$/.test(current)
      ? `${current}${template}`
      : `${current} ${template}`
    : template
  setVariableTargetValue(targetId, nextValue)
}

function suggestJsonVariableKey(binding: { key: string; label: string }): string {
  const nodeOutputMatch = binding.key.match(/node\.\d+\.(.+)$/)
  if (nodeOutputMatch) return nodeOutputMatch[1]
  const inputMatch = binding.key.match(/input\.(.+)$/)
  if (inputMatch) return inputMatch[1]
  return binding.label.replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'value'
}

function insertVariableJsonBinding(targetId: string, binding: { key: string; label: string; template: string }) {
  const currentRaw = getVariableTargetValue(targetId)
  try {
    const current = currentRaw ? JSON.parse(currentRaw) : {}
    if (!current || typeof current !== 'object' || Array.isArray(current)) return
    const next = { ...(current as Record<string, unknown>) }
    const key = suggestJsonVariableKey(binding)
    next[key] = binding.template
    setVariableTargetValue(targetId, JSON.stringify(next, null, 2))
  } catch {
    return
  }
}

type BindingRow = {
  path: string
  template: string
  occurrence: number
  scope: 'config' | 'executor'
}

function findVariableTemplates(
  value: unknown,
  path: string,
  scope: 'config' | 'executor',
  rows: BindingRow[],
) {
  if (typeof value === 'string') {
    const matches = value.match(/\{\{[^}]+\}\}/g) ?? []
    let occurrence = 0
    for (const template of matches) {
      rows.push({ path, template, occurrence, scope })
      occurrence += 1
    }
    return
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => findVariableTemplates(item, `${path}[${index}]`, scope, rows))
    return
  }

  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      findVariableTemplates(child, path ? `${path}.${key}` : key, scope, rows)
    }
  }
}

const selectedBindingSummary = computed(() => {
  if (!selectedNode.value) return [] as Array<BindingRow & { source?: string }>

  const rows: BindingRow[] = []

  findVariableTemplates(selectedNode.value.config, 'config', 'config', rows)

  if (selectedNode.value.type === 'executor_call') {
    findVariableTemplates(selectedExecutorParams.value, 'executor', 'executor', rows)
  }

  return rows.map((row) => {
    const matchedBinding = availableVariableBindings.value.find((binding) => binding.template === row.template)
    return {
      ...row,
      source: matchedBinding?.source,
    }
  })
})

function parsePathSegments(path: string): Array<string | number> {
  const segments: Array<string | number> = []
  const regex = /([^.\[\]]+)|\[(\d+)\]/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(path)) !== null) {
    if (match[2] !== undefined) segments.push(Number(match[2]))
    else segments.push(match[1])
  }
  return segments
}

function cloneJson<T>(value: T): T {
  return value == null ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function mutateLeafString(
  root: unknown,
  segments: Array<string | number>,
  mutate: (leaf: string) => string,
): unknown {
  if (segments.length === 0) {
    return typeof root === 'string' ? mutate(root) : root
  }
  const [head, ...rest] = segments
  if (Array.isArray(root) && typeof head === 'number') {
    const next = [...root]
    next[head] = mutateLeafString(next[head], rest, mutate)
    return next
  }
  if (root && typeof root === 'object' && typeof head === 'string') {
    const next = { ...(root as Record<string, unknown>) }
    next[head] = mutateLeafString(next[head], rest, mutate)
    return next
  }
  return root
}

function replaceNthOccurrence(source: string, template: string, occurrence: number, replacement: string): string {
  let index = 0
  let seen = 0
  while (index < source.length) {
    const found = source.indexOf(template, index)
    if (found === -1) return source
    if (seen === occurrence) {
      return source.slice(0, found) + replacement + source.slice(found + template.length)
    }
    seen += 1
    index = found + template.length
  }
  return source
}

function rewriteBinding(row: BindingRow, nextTemplate: string | null) {
  if (!selectedNode.value) return

  const [scopeSegment, ...pathRest] = parsePathSegments(row.path)
  const segments = scopeSegment === row.scope ? pathRest : parsePathSegments(row.path)

  const mutate = (leaf: string) => {
    if (nextTemplate === null) {
      const without = replaceNthOccurrence(leaf, row.template, row.occurrence, '')
      return without.replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+$/g, '').trimEnd()
    }
    return replaceNthOccurrence(leaf, row.template, row.occurrence, nextTemplate)
  }

  if (row.scope === 'config') {
    const rootKey = segments[0]
    if (typeof rootKey !== 'string') return
    const currentValue = (selectedNode.value.config as Record<string, unknown>)[rootKey]
    const nextValue = mutateLeafString(cloneJson(currentValue), segments.slice(1), mutate)
    handleUpdateConfig(rootKey, nextValue)
    return
  }

  const rootKey = segments[0]
  if (typeof rootKey !== 'string') return
  const currentValue = (selectedExecutorParams.value as Record<string, unknown>)[rootKey]
  const nextValue = mutateLeafString(cloneJson(currentValue), segments.slice(1), mutate)
  updateExecutorParam(rootKey, nextValue)
}

function retargetBinding(row: BindingRow, nextTemplate: string) {
  if (!nextTemplate || nextTemplate === row.template) return
  rewriteBinding(row, nextTemplate)
}

function removeBinding(row: BindingRow) {
  rewriteBinding(row, null)
}

const runtimeExecutors = computed(() =>
  availableExecutors.value.map((executor) => {
    const preset = EXECUTOR_PRESETS[executor.name]
    return preset
      ? {
          ...preset,
          ...executor,
          metadata: {
            ...(preset.metadata ?? {}),
            ...(executor.metadata ?? {}),
          },
        }
      : executor
  }),
)

const runtimeAgentAdapters = computed(() =>
  availableAgentAdapters.value.map((adapter) => {
    const preset = AGENT_ADAPTER_PRESETS[adapter.id]
    return preset ? { ...preset, ...adapter } : adapter
  }),
)

const selectedRunDevice = computed(() =>
  runtimeDeviceManifest.value.find((device) => device.id === selectedRunDeviceId.value) ?? null,
)

const selectedRunCapabilities = computed(() =>
  (selectedRunDevice.value?.capabilities ?? []) as DeviceRuntimeManifestCapabilitySummary[],
)

const selectedRunCapability = computed(() =>
  selectedRunCapabilities.value.find((capability) => capability.capability_id === selectedRunCapabilityId.value)
    ?? selectedRunCapabilities.value[0]
    ?? null,
)

function tryParseJsonObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

function startNodeInputsForWorkflow(): Record<string, unknown> {
  const startNode = workflowNodes.value.find((node) => node.type === 'start')
  const inputs = startNode?.config?.inputs
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return {}
  return JSON.parse(JSON.stringify(inputs)) as Record<string, unknown>
}

function syncRunInputsFromWorkflowDefaults() {
  const defaults = startNodeInputsForWorkflow()
  runInputsText.value = JSON.stringify(defaults, null, 2)
  syncRunSelectionFromInputs()
}

async function loadWorkflowRunHistory() {
  if (!currentWorkflow.value) {
    workflowRunHistory.value = []
    return
  }
  try {
    const result = await workflowApi.runs(currentWorkflow.value.id)
    workflowRunHistory.value = result.runs ?? []
  } catch {
    workflowRunHistory.value = []
  }
}

async function loadWorkflowRunPresets() {
  if (!currentWorkflow.value) {
    workflowRunPresets.value = []
    return
  }
  try {
    const result = await memoryAssetsApi.list()
    workflowRunPresets.value = buildWorkflowRunPresets(currentWorkflow.value, result.assets ?? [])
  } catch {
    workflowRunPresets.value = []
  }
}

function syncRunSelectionFromInputs() {
  if (runtimeDeviceManifest.value.length === 0) {
    selectedRunDeviceId.value = null
    selectedRunCapabilityId.value = ''
    return
  }

  const inputs = tryParseJsonObject(runInputsText.value)
  const deviceId = Number(inputs?.device_id)
  if (Number.isFinite(deviceId) && runtimeDeviceManifest.value.some((device) => device.id === deviceId)) {
    selectedRunDeviceId.value = deviceId
  } else if (runtimeDeviceManifest.value.length > 0) {
    selectedRunDeviceId.value = runtimeDeviceManifest.value[0].id
  }

  const activeDevice = runtimeDeviceManifest.value.find((device) => device.id === selectedRunDeviceId.value) ?? null
  const capabilities = (activeDevice?.capabilities ?? []) as DeviceRuntimeManifestCapabilitySummary[]
  const capabilityId = String(inputs?.capability_id ?? '')
  if (capabilityId && capabilities.some((capability) => capability.capability_id === capabilityId)) {
    selectedRunCapabilityId.value = capabilityId
    return
  }

  if (!capabilities.some((capability) => capability.capability_id === selectedRunCapabilityId.value)) {
    selectedRunCapabilityId.value = capabilities[0]?.capability_id ?? ''
  }
}

function loadRuntimeDeviceManifest() {
  runtimeDeviceManifestLoading.value = true
  return api.userDevices.runtimeManifest({ online: true, capabilities: 'summary', limit: 20 })
    .then((result) => {
      runtimeDeviceManifest.value = result.manifest.devices ?? []
      syncRunSelectionFromInputs()
    })
    .catch(() => {
      runtimeDeviceManifest.value = []
    })
    .finally(() => {
      runtimeDeviceManifestLoading.value = false
    })
}

function applyRunSelectionToInputs() {
  const inputs = tryParseJsonObject(runInputsText.value) ?? {}
  if (selectedRunDeviceId.value != null) {
    inputs.device_id = selectedRunDeviceId.value
  }
  if (selectedRunCapability.value) {
    inputs.capability_id = selectedRunCapability.value.capability_id
    for (const [key, value] of Object.entries(selectedRunCapability.value.sample_arguments ?? {})) {
      if (inputs[key] == null || inputs[key] === '') {
        inputs[key] = value
      }
    }
  }
  runInputsText.value = JSON.stringify(inputs, null, 2)
  runInputError.value = ''
}

function handleSelectRunDevice(id: number | null) {
  selectedRunDeviceId.value = id
  const device = runtimeDeviceManifest.value.find((item) => item.id === id) ?? null
  const capabilities = (device?.capabilities ?? []) as DeviceRuntimeManifestCapabilitySummary[]
  if (capabilities.length === 0) {
    selectedRunCapabilityId.value = ''
    return
  }
  if (!capabilities.some((capability) => capability.capability_id === selectedRunCapabilityId.value)) {
    selectedRunCapabilityId.value = capabilities[0].capability_id
  }
}

function handleSelectRunCapability(capabilityId: string) {
  selectedRunCapabilityId.value = capabilityId
}

onConnect((params: Connection) => {
  const sourceIdx = Number(params.source.replace('node_', ''))
  const targetIdx = Number(params.target.replace('node_', ''))
  if (!Number.isNaN(sourceIdx) && !Number.isNaN(targetIdx)) {
    addEdge({
      source_node_id: sourceIdx,
      target_node_id: targetIdx,
      source_port: params.sourceHandle ?? 'out',
      target_port: params.targetHandle ?? 'in',
      condition: {},
    })
  }
})

function onNodeClick(event: { node: { id: string } }) {
  const idx = Number(event.node.id.replace('node_', ''))
  if (!Number.isNaN(idx)) {
    selectedNodeIndex.value = idx
    syncEditorState()
  }
}

function onPaneClick() {
  selectedNodeIndex.value = null
}

function onDragOver(event: DragEvent) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDrop(event: DragEvent) {
  const type = event.dataTransfer?.getData('application/vueflow-type')
  const label = event.dataTransfer?.getData('application/vueflow-label')
  if (!type || !label) return

  const bounds = vueFlowRef.value?.getBoundingClientRect()
  if (!bounds) return

  const position = project({
    x: event.clientX - bounds.left,
    y: event.clientY - bounds.top,
  })

  addNode(type, label, position)
}

function onNodeDragStop(event: { node: { id: string; position: { x: number; y: number } } }) {
  const idx = Number(event.node.id.replace('node_', ''))
  if (!Number.isNaN(idx) && workflowNodes.value[idx]) {
    workflowNodes.value[idx].position = event.node.position
  }
}

async function handleCreate() {
  const name = window.prompt(t('studio.workflowNamePrompt'))
  if (!name) return
  const createdId = await createWorkflow(name)
  if (createdId) {
    await router.push(buildWorkflowRoute(createdId, 'editor'))
    syncEditorState()
  }
}

async function handleReseedDefaults() {
  if (!window.confirm(t('studio.reseedConfirm'))) return
  const activeId = currentWorkflow.value?.id ?? null
  const result = await reseedDefaults(true)
  if (activeId != null && workflows.value.some((workflow) => workflow.id === activeId)) {
    await selectWorkflow(activeId)
  } else if (workflowShowcase.value.length > 0) {
    await selectWorkflow(workflowShowcase.value[0].id)
  }
  window.alert(t('studio.reseedDone', {
    created: result.created.length,
    updated: result.updated.length,
    skipped: result.skipped.length,
  }))
}

async function selectWorkflow(id: number) {
  latestRun.value = null
  latestPreview.value = null
  activeRunId.value = null
  selectedNodeIndex.value = null
  await loadWorkflow(id)
  syncEditorState()
  syncRunInputsFromWorkflowDefaults()
  await loadWorkflowRunHistory()
  await loadWorkflowRunPresets()
  const nextRoute = replaceWorkflowRouteId(route.path, id)
  if (route.path !== nextRoute) {
    await router.push(nextRoute)
  }
}

async function handleSave() {
  await saveWorkflow()
}

async function handleTogglePublish() {
  if (!currentWorkflow.value) return
  const nextPublished = !Boolean(currentWorkflow.value.published)
  if (isDirty.value) {
    await saveWorkflow()
  }
  try {
    await setWorkflowPublished(nextPublished)
  } catch (error) {
    window.alert((error as Error).message)
  }
}

async function handleRun() {
  const inputs = parseRunInputs()
  if (!inputs) return

  const result = await runWorkflow(inputs)
  if (result?.data) {
    latestRun.value = result.data
    activeRunId.value = result.data.run_id
    await loadWorkflowRunHistory()
  }
}

async function handlePreview() {
  const inputs = parseRunInputs()
  if (!inputs) return

  const result = await previewWorkflow(inputs)
  if (result?.data) {
    latestPreview.value = result.data
  }
}

function parseRunInputs(): Record<string, unknown> | null {
  runInputError.value = ''
  try {
    return JSON.parse(runInputsText.value || '{}') as Record<string, unknown>
  } catch {
    runInputError.value = t('studio.inputsJsonError')
    return null
  }
}

function handleReuseRunInputs(run: WorkflowRun) {
  const inputs = tryParseJsonObject(run.inputs_json || '{}')
  if (!inputs) {
    runInputError.value = t('studio.inputsJsonError')
    return
  }
  runInputsText.value = JSON.stringify(inputs, null, 2)
  runInputError.value = ''
  syncRunSelectionFromInputs()
}

function handleApplyRunPreset(preset: WorkflowRunPreset) {
  runInputsText.value = JSON.stringify(preset.inputs, null, 2)
  runInputError.value = ''
  syncRunSelectionFromInputs()
}

async function handleSaveRunMemory(run: WorkflowRun) {
  if (!currentWorkflow.value) return
  if (workflowRunMemoryStatus.value[run.id] === 'saving' || workflowRunMemoryStatus.value[run.id] === 'saved') return

  const payload = buildWorkflowRunExperiencePayload(currentWorkflow.value, run)
  if (!payload) {
    workflowRunMemoryStatus.value = { ...workflowRunMemoryStatus.value, [run.id]: 'error' }
    workflowRunMemoryErrors.value = { ...workflowRunMemoryErrors.value, [run.id]: t('studio.inputsJsonError') }
    return
  }

  workflowRunMemoryStatus.value = { ...workflowRunMemoryStatus.value, [run.id]: 'saving' }
  workflowRunMemoryErrors.value = { ...workflowRunMemoryErrors.value, [run.id]: '' }
  try {
    const result = await memoryAssetsApi.recordExperiencePath(payload)
    if (result.status !== 'success') throw new Error(result.message || 'Save failed')
    workflowRunMemoryStatus.value = { ...workflowRunMemoryStatus.value, [run.id]: 'saved' }
    await loadWorkflowRunPresets()
  } catch (err) {
    workflowRunMemoryStatus.value = { ...workflowRunMemoryStatus.value, [run.id]: 'error' }
    workflowRunMemoryErrors.value = { ...workflowRunMemoryErrors.value, [run.id]: (err as Error).message }
  }
}

async function handleDelete() {
  if (!currentWorkflow.value) return
  if (!window.confirm(t('studio.deleteConfirm'))) return
  await deleteWorkflow(currentWorkflow.value.id)
  latestRun.value = null
  latestPreview.value = null
  activeRunId.value = null
  workflowRunHistory.value = []
  workflowRunPresets.value = []
  if (workflowShowcase.value.length > 0) {
    await selectWorkflow(workflowShowcase.value[0].id)
    return
  }
  if (workflows.value.length > 0) {
    await selectWorkflow(workflows.value[0].id)
    return
  }
  await router.push('/studio')
}

function handleUpdateConfig(key: string, value: unknown) {
  if (selectedNodeIndex.value == null) return
  updateNodeConfig(selectedNodeIndex.value, { [key]: value })
  if (selectedNode.value?.type === 'executor_call' && key === 'params') {
    syncEditorState()
  }
}

function handleUpdateLabel(value: string) {
  if (selectedNodeIndex.value == null) return
  workflowNodes.value[selectedNodeIndex.value].label = value
  isDirty.value = true
}

function handleSelectTraceNode(nodeId: string) {
  const index = nodeIdToFlowIndex.value.get(Number(nodeId))
  if (index == null) return
  selectedNodeIndex.value = index
  syncEditorState()
}

function handleRemoveNode() {
  if (selectedNodeIndex.value == null) return
  removeNode(selectedNodeIndex.value)
  selectedNodeIndex.value = null
}

function onDragStart(event: DragEvent, type: string, label: string) {
  if (!event.dataTransfer) return
  event.dataTransfer.setData('application/vueflow-type', type)
  event.dataTransfer.setData('application/vueflow-label', label)
  event.dataTransfer.effectAllowed = 'move'
}

function syncEditorState() {
  if (selectedNode.value?.type === 'executor_call') {
    executorParamsText.value = JSON.stringify(selectedNode.value.config.params ?? {}, null, 2)
  } else {
    executorParamsText.value = '{}'
  }
}

function setExecutorParams(params: Record<string, unknown>) {
  handleUpdateConfig('params', params)
  syncEditorState()
}

function mergeExecutorParams(patch: Record<string, unknown>) {
  const current = ((selectedNode.value?.config.params as Record<string, unknown>) ?? {})
  setExecutorParams({ ...current, ...patch })
}

function updateExecutorParam(key: string, value: unknown) {
  mergeExecutorParams({ [key]: value })
}

function updateExecutorObjectParam(key: string, raw: string) {
  try {
    const parsed = JSON.parse(raw || '{}')
    updateExecutorParam(key, parsed)
  } catch {
    return
  }
}

function normalizeCLIParamType(rawType: string): string {
  return rawType.replace(/\?$/, '')
}

function currentCLIActionParams(): Record<string, unknown> {
  const params = selectedExecutorParams.value.params
  return params && typeof params === 'object' && !Array.isArray(params)
    ? { ...(params as Record<string, unknown>) }
    : {}
}

function formatCLIParamValue(key: string, type: string): string {
  const value = currentCLIActionParams()[key]
  if (value == null) return ''
  if (type === 'object' || type === 'array' || type.endsWith('[]')) {
    return Array.isArray(value) && (type === 'string[]' || type === 'number[]' || type === 'boolean[]')
      ? value.join(', ')
      : JSON.stringify(value, null, 2)
  }
  return String(value)
}

function updateCLIActionParam(key: string, type: string, rawValue: unknown) {
  const next = currentCLIActionParams()
  let value: unknown = rawValue

  if (type === 'number') {
    value = rawValue === '' ? undefined : Number(rawValue)
  } else if (type === 'boolean') {
    value = Boolean(rawValue)
  } else if (type === 'string[]') {
    value = String(rawValue ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  } else if (type === 'number[]') {
    value = String(rawValue ?? '')
      .split(',')
      .map((item) => Number(item.trim()))
      .filter((item) => Number.isFinite(item))
  } else if (type === 'boolean[]') {
    value = String(rawValue ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean)
      .map((item) => item === 'true' || item === '1' || item === 'yes')
  }

  if (value === undefined || value === '') {
    delete next[key]
  } else {
    next[key] = value
  }
  updateExecutorParam('params', next)
}

function updateCLIActionJsonParam(key: string, raw: string) {
  try {
    const parsed = JSON.parse(raw || '{}')
    const next = currentCLIActionParams()
    next[key] = parsed
    updateExecutorParam('params', next)
  } catch {
    return
  }
}

function updateNodeObjectConfig(key: string, raw: string) {
  try {
    const parsed = JSON.parse(raw || '{}')
    handleUpdateConfig(key, parsed)
  } catch {
    return
  }
}

function formatJsonConfigValue(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

function updateNumberConfig(key: string, raw: string) {
  handleUpdateConfig(key, raw === '' ? null : Number(raw))
}

function updateSelectConfig(field: WorkflowNodeConfigField, raw: string) {
  const option = field.options?.find((item) => String(item.value) === raw)
  handleUpdateConfig(field.key, option ? option.value : raw)
}

function commitSelectedNodeConfig(raw: string) {
  if (selectedNodeIndex.value == null) return
  try {
    const parsed = JSON.parse(raw || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    workflowNodes.value[selectedNodeIndex.value].config = parsed as Record<string, unknown>
    isDirty.value = true
    syncEditorState()
  } catch {
    return
  }
}

function formatTraceJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? {}, null, 2)
  } catch {
    return '{}'
  }
}

function applyExecutorPlan(planId: string) {
  if (!selectedNode.value) return
  handleUpdateConfig('executor_name', 'plan.run')
  setExecutorParams({ plan_id: planId })
}

function applyExecutorPreset(executorName: string) {
  if (!selectedNode.value) return
  const descriptor = runtimeExecutors.value.find((executor) => executor.name === executorName)
  const template = descriptor?.metadata?.param_template

  handleUpdateConfig('executor_name', executorName)
  if (template && typeof template === 'object') {
    setExecutorParams(JSON.parse(JSON.stringify(template)))
    return
  }
  setExecutorParams({})
}

function applyCLIExecutorChoice(cliName: string) {
  const cliExecutor = availableCLIExecutors.value.find((executor) => executor.name === cliName)
  const nextAction = cliExecutor?.actions[0] ?? ''
  mergeExecutorParams({
    cli_name: cliName,
    action: nextAction,
    params: {},
  })
}

function applyCLIActionChoice(action: string) {
  mergeExecutorParams({
    action,
    params: {},
  })
}

function applyAgentAdapterChoice(target: string) {
  const adapter = runtimeAgentAdapters.value.find((item) => item.id === target)
  if (!adapter) {
    updateExecutorParam('target', target)
    return
  }

  setExecutorParams({
    ...selectedExecutorParams.value,
    target: adapter.id,
    task: adapter.input_template.task,
    payload: adapter.input_template.payload,
    execution_mode: adapter.execution_modes[0] ?? 'deferred',
  })
}

function applyAgentSampleDispatch() {
  const adapter = selectedAgentAdapter.value
  if (!adapter) return

  setExecutorParams({
    ...selectedExecutorParams.value,
    target: adapter.id,
    task: adapter.sample_dispatch.task,
    payload: adapter.sample_dispatch.payload,
    execution_mode: adapter.sample_dispatch.execution_mode,
  })
}

function commitExecutorParams(raw: string) {
  try {
    const parsed = JSON.parse(raw || '{}')
    setExecutorParams(parsed)
  } catch {
    return
  }
}

const selectedPlanId = computed(() => {
  if (selectedNode.value?.type !== 'executor_call') return ''
  const params = (selectedNode.value.config.params as Record<string, unknown>) ?? {}
  return typeof params.plan_id === 'string' ? params.plan_id : ''
})

const selectedExecutorName = computed(() => {
  if (selectedNode.value?.type !== 'executor_call') return ''
  return String(selectedNode.value.config.executor_name ?? '')
})

const selectedExecutorParams = computed<Record<string, unknown>>(() => {
  if (selectedNode.value?.type !== 'executor_call') return {}
  return ((selectedNode.value.config.params as Record<string, unknown>) ?? {})
})

const selectedExecutorDescriptor = computed(() => {
  if (!selectedExecutorName.value) return null
  return runtimeExecutors.value.find((executor) => executor.name === selectedExecutorName.value) ?? null
})

const selectedCLIExecutor = computed(() => {
  const cliName = String(selectedExecutorParams.value.cli_name ?? '')
  if (!cliName) return null
  return availableCLIExecutors.value.find((executor) => executor.name === cliName) ?? null
})

const selectedCLIActions = computed(() => selectedCLIExecutor.value?.actions ?? [])

const selectedCLIActionDetail = computed(() => {
  const action = String(selectedExecutorParams.value.action ?? '')
  if (!action) return null
  return selectedCLIExecutor.value?.action_details?.find((item) => item.name === action) ?? null
})

const selectedCLIParamEntries = computed(() =>
  Object.entries(selectedCLIActionDetail.value?.params_schema ?? {}).map(([key, rawType]) => {
    const normalizedType = normalizeCLIParamType(rawType)
    return {
      key,
      rawType,
      type: normalizedType,
      required: !rawType.endsWith('?'),
      control: normalizedType === 'boolean'
        ? 'boolean'
        : normalizedType === 'number'
          ? 'number'
          : normalizedType === 'object' || normalizedType === 'array'
            ? 'json'
            : 'text',
    }
  }),
)

const selectedAgentTargets = computed(() => {
  return runtimeAgentAdapters.value
    .filter((adapter) => adapter.enabled)
    .filter((adapter) => adapter.category !== 'coding')
    .map((adapter) => adapter.id)
})

const selectedAgentAdapter = computed(() => {
  const target = String(selectedExecutorParams.value.target ?? '')
  if (!target) return null
  return runtimeAgentAdapters.value.find((adapter) => adapter.id === target) ?? null
})

const workflowShowcase = computed<WorkflowShowcaseCard[]>(() =>
  workflows.value
    .map((workflow) => {
      const meta = WORKFLOW_SHOWCASE[workflow.name]
      return meta ? { ...workflow, ...meta } : null
    })
    .filter((workflow): workflow is WorkflowShowcaseCard => Boolean(workflow))
    .sort((left, right) => left.priority - right.priority),
)

const workbenchWorkflows = computed(() =>
  workflows.value.filter((workflow) => !WORKFLOW_SHOWCASE[workflow.name]),
)

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

const nodeLibrarySections = computed(() => buildNodeLibrarySections(nodeTypes.value, label))
const inspectorCopy = computed(() => buildStudioInspectorCopy(label))
const workflowCollectionMetrics = computed(() => buildWorkflowCollectionMetrics(workflows.value, label))

const workflowHeaderChips = computed(() => {
  if (!currentWorkflow.value) return []
  return buildWorkflowHeaderChips({
    workflow: currentWorkflow.value,
    isDirty: isDirty.value,
    previewExecutable: latestPreview.value?.executable,
    latestRunStatus: latestRun.value?.status,
  }, label)
})

const mainlineHeading = computed(() => buildWorkflowSectionHeading('mainline', workflowShowcase.value.length, label))
const workbenchHeading = computed(() => buildWorkflowSectionHeading('workbench', workbenchWorkflows.value.length, label))
const currentGraphWorkflowRunHistory = computed(() =>
  filterWorkflowRunsForGraph(workflowRunHistory.value, currentWorkflow.value?.graph_hash, currentWorkflow.value?.graph_updated_at),
)
const workflowEditorSummaryItems = computed(() => buildWorkflowEditorSummaryItems({
  nodeCount: workflowNodes.value.length,
  edgeCount: workflowEdges.value.length,
  previewExecutable: latestPreview.value?.executable,
  latestRunStatus: latestRun.value?.status ?? currentGraphWorkflowRunHistory.value[0]?.status,
  successCount: currentGraphWorkflowRunHistory.value.filter((run) => run.status === 'succeeded').length,
  failureCount: currentGraphWorkflowRunHistory.value.filter((run) => run.status === 'failed').length,
}, label))

const workflowPublishEvidence = computed(() =>
  buildWorkflowPublishEvidence(workflowRunHistory.value, label, currentWorkflow.value?.graph_hash, currentWorkflow.value?.graph_updated_at),
)

const availableSubflowWorkflows = computed(() =>
  workflows.value.filter((workflow) => workflow.id !== currentWorkflow.value?.id),
)

function workflowDescription(workflow: Workflow | WorkflowShowcaseCard): string {
  const descriptionMap: Record<string, string> = {
    'Device Capability Rehearsal Demo': t('studio.deviceCapabilityDemo.description' as any),
    'Watch Bilibili On Toshiba TV Demo': workflow.name === 'Watch Bilibili On Toshiba TV Demo'
      ? t('studio.hero.description' as any)
      : '',
    'Bilibili CLI Demo': t('studio.biliCli.description' as any),
    'DLNA Cast Demo': label('通过 dlna-cast-cli 验证 DLNA 设备发现、媒体解析和投屏链路。', 'Validate DLNA discovery, media resolution, and casting through dlna-cast-cli.'),
    'Speaker Cast Demo': label('通过 speaker-cast-cli 验证音箱列表、音乐推送和播放控制链路。', 'Validate speaker listing, music push, and playback control through speaker-cast-cli.'),
    'Bilibili Media Dispatch Demo': t('studio.mediaDispatch.description' as any),
    'Bilibili Subflow Demo': t('studio.subflow.description' as any),
    'Candidate Plan Routing Demo': t('studio.candidateRouting.description' as any),
  }
  return descriptionMap[workflow.name] || workflow.description || t('studio.selectOrCreate')
}

function previewStateLabel(state: WorkflowPreviewResult['steps'][number]['preview_state']) {
  return t(`studio.previewState.${state}` as any)
}

function previewModeLabel(mode: WorkflowPreviewResult['steps'][number]['resolution_mode']) {
  return t(`studio.previewMode.${mode}` as any)
}

function previewRiskLabel(risk: WorkflowPreviewResult['steps'][number]['risk']) {
  return t(`studio.risk.${risk}` as any)
}

watch(selectedNodeIndex, () => {
  syncEditorState()
})

watch(variableFieldTargets, (targets) => {
  if (targets.length === 0) {
    selectedVariableTarget.value = ''
    return
  }
  if (!targets.some((target) => target.id === selectedVariableTarget.value)) {
    selectedVariableTarget.value = targets[0].id
  }
}, { immediate: true })

watch(routeWorkflowId, async (id) => {
  if (!workflowsLoaded.value || id == null || currentWorkflow.value?.id === id) return
  if (workflows.value.some((workflow) => workflow.id === id)) {
    await selectWorkflow(id)
    return
  }
  const fallback = workflowShowcase.value[0] ?? workflows.value[0]
  if (fallback) {
    await selectWorkflow(fallback.id)
  }
})

function handleGlobalKeydown(event: KeyboardEvent) {
  // Only handle shortcuts if not in an input/textarea
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
    return
  }

  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedNodeIndex.value != null) {
    event.preventDefault()
    handleRemoveNode()
  }

  // Ctrl+S to save
  if ((event.ctrlKey || event.metaKey) && event.key === 's') {
    event.preventDefault()
    handleSave()
  }
}

onMounted(async () => {
  window.addEventListener('keydown', handleGlobalKeydown)
  await loadNodeDefinitions()
  await loadWorkflows()
  workflowsLoaded.value = true
  if (routeWorkflowId.value != null && workflows.value.some((workflow) => workflow.id === routeWorkflowId.value)) {
    await selectWorkflow(routeWorkflowId.value)
  } else if (!currentWorkflow.value && workflows.value.length > 0) {
    const preferred = workflowShowcase.value[0] ?? workflows.value[0]
    await selectWorkflow(preferred.id)
  }
  try {
    const executors = await executorApi.listExecutors()
    availableExecutors.value = executors.executors
    availableAgentAdapters.value = executors.agent_adapters
    availableCLIExecutors.value = executors.cli_executors
  } catch {
    availableExecutors.value = []
    availableAgentAdapters.value = []
    availableCLIExecutors.value = []
  }

  try {
    const plans = await executorApi.listPlans()
    availablePlans.value = plans.plans
  } catch {
    availablePlans.value = []
  }

  await loadRuntimeDeviceManifest()
  syncRunSelectionFromInputs()
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleGlobalKeydown)
})
</script>

<template>
  <div class="studio-view">
    <WorkflowSidebar
      :workflows="workflows"
      :current-workflow="currentWorkflow"
      :workflow-collection-metrics="workflowCollectionMetrics"
      :workflow-showcase="workflowShowcase"
      :workbench-workflows="workbenchWorkflows"
      :mainline-heading="mainlineHeading"
      :workbench-heading="workbenchHeading"
      :node-library-sections="nodeLibrarySections"
      :available-plans="availablePlans"
      :t="t"
      :label="label"
      :workflow-description="workflowDescription"
      @reseed="handleReseedDefaults"
      @create="handleCreate"
      @select-workflow="selectWorkflow"
      @apply-plan="applyExecutorPlan"
      @dragstart="onDragStart"
    />

    <CanvasArea
      :current-workflow="currentWorkflow"
      :flow-nodes="flowNodes"
      :flow-edges="flowEdges"
      :node-types-map="nodeTypesMap"
      :latest-run="latestRun"
      :latest-preview="latestPreview"
      :workflow-run-history="workflowRunHistory"
      :workflow-run-presets="workflowRunPresets"
      :workflow-run-memory-status="workflowRunMemoryStatus"
      :workflow-run-memory-errors="workflowRunMemoryErrors"
      :active-run-id="activeRunId"
      v-model:run-inputs-text="runInputsText"
      :run-input-error="runInputError"
      :runtime-device-manifest="runtimeDeviceManifest"
      :runtime-device-manifest-loading="runtimeDeviceManifestLoading"
      :selected-run-device-id="selectedRunDeviceId"
      :selected-run-capability-id="selectedRunCapabilityId"
      :selected-run-capabilities="selectedRunCapabilities"
      :workflow-header-chips="workflowHeaderChips"
      :workflow-editor-summary-items="workflowEditorSummaryItems"
      :workflow-publish-evidence="workflowPublishEvidence"
      :is-dirty="isDirty"
      :t="t"
      :label="label"
      :preview-state-label="previewStateLabel"
      :preview-mode-label="previewModeLabel"
      :preview-risk-label="previewRiskLabel"
      @node-click="onNodeClick"
      @pane-click="onPaneClick"
      @dragover="onDragOver"
      @drop="onDrop"
      @node-drag-stop="onNodeDragStop"
      @show-obs="showObs = true"
      @save="handleSave"
      @toggle-publish="handleTogglePublish"
      @preview="handlePreview"
      @run="handleRun"
      @delete="handleDelete"
      @select-run-device="handleSelectRunDevice"
      @select-run-capability="handleSelectRunCapability"
      @apply-run-device-inputs="applyRunSelectionToInputs"
      @refresh-runtime-device-manifest="loadRuntimeDeviceManifest"
      @reuse-run-inputs="handleReuseRunInputs"
      @apply-run-preset="handleApplyRunPreset"
      @save-run-memory="handleSaveRunMemory"
      @select-trace-node="handleSelectTraceNode"
      @update-active-steps="activeStepNodeIds = $event"
    />

    <NodeInspector
      v-if="selectedNode"
      :selected-node="selectedNode"
      :selected-node-index="selectedNodeIndex"
      :selected-node-definition="selectedNodeDefinition"
      :selected-config-fields="selectedConfigFields"
      :selected-output-fields="selectedOutputFields"
      :selected-node-trace="selectedNodeTrace"
      :available-variable-bindings="availableVariableBindings"
      :variable-field-targets="variableFieldTargets"
      v-model:selected-variable-target="selectedVariableTarget"
      :selected-binding-summary="selectedBindingSummary"
      :runtime-executors="runtimeExecutors"
      :runtime-agent-adapters="runtimeAgentAdapters"
      :available-plans="availablePlans"
      :available-cli-executors="availableCLIExecutors"
      :selected-executor-name="selectedExecutorName"
      :selected-executor-params="selectedExecutorParams"
      :selected-executor-descriptor="selectedExecutorDescriptor"
      :selected-cli-executor="selectedCLIExecutor"
      :selected-cli-actions="selectedCLIActions"
      :selected-cli-action-detail="selectedCLIActionDetail"
      :selected-cli-param-entries="selectedCLIParamEntries"
      :selected-agent-targets="selectedAgentTargets"
      :selected-agent-adapter="selectedAgentAdapter"
      :runtime-device-manifest="runtimeDeviceManifest"
      :runtime-device-manifest-loading="runtimeDeviceManifestLoading"
      :available-subflow-workflows="availableSubflowWorkflows"
      :workflows="workflows"
      v-model:executor-params-text="executorParamsText"
      :inspector-copy="inspectorCopy"
      :has-unsaved-variable-sources="hasUnsavedVariableSources"
      :label="label"
      @remove-node="handleRemoveNode"
      @update-label="handleUpdateLabel"
      @update-config="handleUpdateConfig"
      @update-executor-param="updateExecutorParam"
      @update-executor-object-param="updateExecutorObjectParam"
      @apply-executor-preset="applyExecutorPreset"
      @apply-executor-plan="applyExecutorPlan"
      @apply-cli-executor="applyCLIExecutorChoice"
      @apply-cli-action="applyCLIActionChoice"
      @apply-agent-adapter="applyAgentAdapterChoice"
      @apply-agent-sample="applyAgentSampleDispatch"
      @refresh-runtime-device-manifest="loadRuntimeDeviceManifest"
      @update-cli-param="updateCLIActionParam"
      @update-cli-json-param="updateCLIActionJsonParam"
      @update-node-object-config="updateNodeObjectConfig"
      @commit-executor-params="commitExecutorParams"
      @commit-node-config="commitSelectedNodeConfig"
      @update-number-config="updateNumberConfig"
      @update-select-config="updateSelectConfig"
      @retarget-binding="retargetBinding"
      @remove-binding="removeBinding"
      @insert-variable-json="insertVariableJsonBinding"
      @insert-variable-template="insertVariableTemplate"
    />
    <ObservabilityPanel :open="showObs" @close="showObs = false" />
  </div>
</template>

<style scoped>
.studio-view {
  display: flex;
  height: 100%;
  background: #f7f9fa;
  overflow: hidden;
  position: relative;
}

/* Base layout transition for inspector appearing */
.studio-view > * {
  transition: all 0.35s cubic-bezier(0.4, 0, 0.2, 1);
}

.canvas-area {
  flex: 1;
  display: flex;
  min-width: 0;
  position: relative;
  background:
    radial-gradient(circle at 20% 20%, rgba(255, 255, 255, 0.9) 0%, transparent 40%),
    radial-gradient(circle at 80% 80%, rgba(16, 185, 129, 0.04) 0%, transparent 40%),
    radial-gradient(circle at 50% 50%, #f8fafc 0%, #f1f4f7 100%);
}
</style>
