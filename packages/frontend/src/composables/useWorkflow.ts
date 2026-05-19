import { ref } from 'vue'
import {
  workflowApi,
  type Workflow,
  type WorkflowNodeData,
  type WorkflowEdgeData,
  type WorkflowNodeDefinition,
} from '../api/workflow'

export function useWorkflow() {
  const workflows = ref<Workflow[]>([])
  const currentWorkflow = ref<Workflow | null>(null)
  const nodes = ref<WorkflowNodeData[]>([])
  const edges = ref<WorkflowEdgeData[]>([])
  const loading = ref(false)
  const isDirty = ref(false)
  const nodeTypes = ref<WorkflowNodeDefinition[]>([])

  async function loadWorkflows() {
    loading.value = true
    try {
      const result = await workflowApi.list()
      workflows.value = result.workflows || []
    } finally {
      loading.value = false
    }
  }

  async function loadNodeDefinitions() {
    try {
      const result = await workflowApi.listNodeDefinitions()
      nodeTypes.value = result.node_definitions ?? []
      if (nodeTypes.value.length > 0) return
    } catch {}

    nodeTypes.value = DEFAULT_NODE_TYPES
  }

  async function loadWorkflow(id: number) {
    loading.value = true
    try {
      const result = await workflowApi.get(id)
      currentWorkflow.value = result.workflow
      nodes.value = (result.nodes || []).map((node: any) => ({
        ...node,
        config: typeof node.config_json === 'string' ? JSON.parse(node.config_json) : (node.config_json ?? {}),
        position: typeof node.position_json === 'string' ? JSON.parse(node.position_json) : (node.position_json ?? { x: 0, y: 0 }),
      }))
      edges.value = (result.edges || []).map((edge: any) => ({
        source_node_id: edge.source_node_id,
        target_node_id: edge.target_node_id,
        source_port: edge.source_port ?? 'out',
        target_port: edge.target_port ?? 'in',
        condition: typeof edge.condition_json === 'string' ? JSON.parse(edge.condition_json) : (edge.condition_json ?? {}),
      }))
      isDirty.value = false
    } finally {
      loading.value = false
    }
  }

  async function createWorkflow(name: string) {
    const result = await workflowApi.create({ name })
    if (result.data?.id) {
      await loadWorkflows()
      await loadWorkflow(result.data.id)
    }
    return result.data?.id
  }

  async function reseedDefaults(overwrite = true) {
    const result = await workflowApi.reseedDefaults(overwrite)
    const currentId = currentWorkflow.value?.id ?? null
    await loadWorkflows()
    if (currentId != null && workflows.value.some((workflow) => workflow.id === currentId)) {
      await loadWorkflow(currentId)
    }
    return result.data
  }

  async function saveWorkflow() {
    if (!currentWorkflow.value) return
    await workflowApi.update(currentWorkflow.value.id, {
      nodes: nodes.value,
      edges: edges.value,
    })
    isDirty.value = false
  }

  async function runWorkflow(inputs?: Record<string, unknown>) {
    if (!currentWorkflow.value) return
    await saveWorkflow()
    return workflowApi.run(currentWorkflow.value.id, inputs)
  }

  async function previewWorkflow(inputs?: Record<string, unknown>) {
    if (!currentWorkflow.value) return
    await saveWorkflow()
    return workflowApi.preview(currentWorkflow.value.id, inputs)
  }

  async function deleteWorkflow(id: number) {
    await workflowApi.delete(id)
    if (currentWorkflow.value?.id === id) {
      currentWorkflow.value = null
      nodes.value = []
      edges.value = []
    }
    await loadWorkflows()
  }

  function addNode(type: string, label: string, position: { x: number; y: number }) {
    const definition = nodeTypes.value.find((nodeType) => nodeType.type === type)
    nodes.value.push({
      type,
      label,
      config: cloneRecord(definition?.default_config ?? {}),
      position,
    })
    isDirty.value = true
  }

  function updateNodeConfig(index: number, config: Record<string, unknown>) {
    if (!nodes.value[index]) return
    nodes.value[index].config = { ...nodes.value[index].config, ...config }
    isDirty.value = true
  }

  function removeNode(index: number) {
    nodes.value.splice(index, 1)
    isDirty.value = true
  }

  function addEdge(edge: WorkflowEdgeData) {
    edges.value.push(edge)
    isDirty.value = true
  }

  function removeEdge(index: number) {
    edges.value.splice(index, 1)
    isDirty.value = true
  }

  const DEFAULT_NODE_TYPES = [
    { type: 'start', label: 'Start', icon: 'S', color: '#18a058', category: 'trigger', description: 'Entry node.', default_config: { inputs: {} }, config_schema: [{ key: 'inputs', label: 'Default Inputs', control: 'json' }] },
    { type: 'device_control', label: 'Device Control', icon: 'D', color: '#2080f0', category: 'device', description: 'Control Mi device entity.', default_config: { did: '', siid: 0, piid: 0, value: '' }, config_schema: [{ key: 'did', label: 'Device ID', control: 'text' }, { key: 'siid', label: 'Service IID', control: 'number' }, { key: 'piid', label: 'Property IID', control: 'number' }, { key: 'aiid', label: 'Action IID', control: 'number' }, { key: 'value', label: 'Value', control: 'text' }, { key: 'params', label: 'Action Params', control: 'json' }] },
    { type: 'xiaoai', label: 'XiaoAi', icon: 'X', color: '#f0a020', category: 'device', description: 'Send TTS to XiaoAi speaker.', default_config: { text: '', silent: false }, config_schema: [{ key: 'text', label: 'Text', control: 'textarea' }, { key: 'silent', label: 'Silent Mode', control: 'boolean' }] },
    { type: 'ir_control', label: 'IR Control', icon: 'I', color: '#909399', category: 'device', description: 'Send IR key command.', default_config: { controller_id: '', key_id: '' }, config_schema: [{ key: 'controller_id', label: 'Controller ID', control: 'text' }, { key: 'key_id', label: 'Key ID', control: 'text' }] },
    { type: 'llm', label: 'LLM', icon: 'L', color: '#8a2be2', category: 'compute', description: 'Run LLM inference.', default_config: { prompt: '', temperature: 0.7 }, config_schema: [{ key: 'prompt', label: 'Prompt', control: 'textarea' }, { key: 'temperature', label: 'Temperature', control: 'number' }] },
    { type: 'if_else', label: 'Condition', icon: '?', color: '#f0a020', category: 'logic', description: 'Boolean branch routing.', default_config: { left: '', operator: '==', right: '' }, config_schema: [{ key: 'left', label: 'Left', control: 'text' }, { key: 'operator', label: 'Operator', control: 'select', options: [{ label: '==', value: '==' }, { label: '!=', value: '!=' }, { label: '>', value: '>' }, { label: '<', value: '<' }, { label: '>=', value: '>=' }, { label: '<=', value: '<=' }, { label: 'contains', value: 'contains' }] }, { key: 'right', label: 'Right', control: 'text' }] },
    { type: 'delay', label: 'Delay', icon: 'T', color: '#909399', category: 'control', description: 'Pause for milliseconds.', default_config: { duration: 1000 }, config_schema: [{ key: 'duration', label: 'Duration MS', control: 'number' }] },
    { type: 'parallel', label: 'Parallel', icon: 'P', color: '#2080f0', category: 'control', description: 'Parallel orchestration node.', default_config: {}, config_schema: [] },
    { type: 'subflow', label: 'Subflow', icon: 'F', color: '#1f7a4f', category: 'control', description: 'Run child workflow.', default_config: { workflow_id: null, workflow_name: '', inputs: {}, output_key: '' }, config_schema: [{ key: 'workflow_id', label: 'Workflow ID', control: 'number' }, { key: 'workflow_name', label: 'Workflow Name', control: 'text' }, { key: 'inputs', label: 'Inputs', control: 'json' }, { key: 'output_key', label: 'Output Key', control: 'text' }] },
    { type: 'code', label: 'Code', icon: 'C', color: '#333', category: 'compute', description: 'Run inline JavaScript transform.', default_config: { code: '', inputs: {} }, config_schema: [{ key: 'inputs', label: 'Inputs', control: 'json' }, { key: 'code', label: 'Code', control: 'textarea' }] },
    { type: 'executor_call', label: 'Executor Call', icon: 'E', color: '#18a058', category: 'control', description: 'Invoke executor via gateway.', default_config: { executor_name: '', params: {} }, config_schema: [{ key: 'executor_name', label: 'Executor Name', control: 'text' }, { key: 'params', label: 'Params', control: 'json' }] },
    { type: 'answer', label: 'Answer', icon: 'A', color: '#d03050', category: 'output', description: 'Output final answer.', default_config: { message: '' }, config_schema: [{ key: 'message', label: 'Message', control: 'textarea' }] },
  ].map((definition) => ({
    ...definition,
    output_schema: [],
  })) as WorkflowNodeDefinition[]

  if (nodeTypes.value.length === 0) {
    nodeTypes.value = DEFAULT_NODE_TYPES
  }

  return {
    workflows,
    currentWorkflow,
    nodes,
    edges,
    loading,
    isDirty,
    nodeTypes,
    loadNodeDefinitions,
    loadWorkflows,
    loadWorkflow,
    createWorkflow,
    reseedDefaults,
    saveWorkflow,
    runWorkflow,
    previewWorkflow,
    deleteWorkflow,
    addNode,
    updateNodeConfig,
    removeNode,
    addEdge,
    removeEdge,
  }
}

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>
}
