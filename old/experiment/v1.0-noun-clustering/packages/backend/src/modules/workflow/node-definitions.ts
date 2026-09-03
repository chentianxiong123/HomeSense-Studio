export interface WorkflowNodeDefinition {
  type: string
  label: string
  icon: string
  color: string
  category: 'trigger' | 'device' | 'logic' | 'compute' | 'control' | 'output'
  description: string
  default_config: Record<string, unknown>
  config_schema: WorkflowNodeConfigField[]
  output_schema: WorkflowNodeOutputField[]
}

export interface WorkflowNodeConfigField {
  key: string
  label: string
  control: 'text' | 'textarea' | 'number' | 'boolean' | 'json' | 'select'
  required?: boolean
  placeholder?: string
  helper?: string
  options?: Array<{ label: string; value: string | number | boolean }>
}

export interface WorkflowNodeOutputField {
  key: string
  label: string
  type: 'boolean' | 'string' | 'number' | 'object' | 'array' | 'unknown'
  description?: string
}

const DEFINITIONS: WorkflowNodeDefinition[] = [
  {
    type: 'start',
    label: 'Start',
    icon: 'S',
    color: '#18a058',
    category: 'trigger',
    description: 'Entry node. Injects default input values when runtime inputs are missing.',
    default_config: { inputs: {} },
    config_schema: [
      { key: 'inputs', label: 'Default Inputs', control: 'json', helper: 'Merged into input.* variables when runtime inputs are missing.' },
    ],
    output_schema: [
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when the workflow run starts.' },
    ],
  },
  {
    type: 'device_control',
    label: 'Device Control',
    icon: 'D',
    color: '#2080f0',
    category: 'device',
    description: 'Read, write, or trigger action against a Mi device entity through mi-cli.',
    default_config: { did: '', siid: 0, piid: 0, value: '' },
    config_schema: [
      { key: 'did', label: 'Device ID', control: 'text', required: true },
      { key: 'siid', label: 'Service IID', control: 'number', required: true },
      { key: 'piid', label: 'Property IID', control: 'number' },
      { key: 'aiid', label: 'Action IID', control: 'number' },
      { key: 'value', label: 'Value', control: 'text' },
      { key: 'params', label: 'Action Params', control: 'json' },
    ],
    output_schema: [
      { key: 'result', label: 'Result', type: 'object', description: 'Raw mi-cli result data for get/set/action calls.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when the device operation succeeds.' },
    ],
  },
  {
    type: 'xiaoai',
    label: 'XiaoAi',
    icon: 'X',
    color: '#f0a020',
    category: 'device',
    description: 'Ask XiaoAi to execute a MIoT directive or speak text through mi-cli.',
    default_config: { mode: 'execute', text: '', silent: true, did: '' },
    config_schema: [
      {
        key: 'mode',
        label: 'Mode',
        control: 'select',
        options: [
          { label: 'Execute Directive', value: 'execute' },
          { label: 'Speak Text', value: 'play' },
        ],
      },
      { key: 'text', label: 'Text', control: 'textarea', required: true },
      { key: 'did', label: 'Speaker DID', control: 'text' },
      { key: 'silent', label: 'Silent Mode', control: 'boolean' },
    ],
    output_schema: [
      { key: 'result', label: 'Result', type: 'object', description: 'Raw mi-cli result data.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when the XiaoAi request succeeds.' },
    ],
  },
  {
    type: 'ir_control',
    label: 'IR Control',
    icon: 'I',
    color: '#909399',
    category: 'device',
    description: 'Send a key command through IR controller.',
    default_config: { controller_id: '', key_id: '' },
    config_schema: [
      { key: 'controller_id', label: 'Controller ID', control: 'text', required: true },
      { key: 'key_id', label: 'Key ID', control: 'text', required: true },
    ],
    output_schema: [
      { key: 'result', label: 'Result', type: 'object', description: 'IR command result payload.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when the IR command succeeds.' },
    ],
  },
  {
    type: 'scene_execute',
    label: 'Scene Execute',
    icon: 'M',
    color: '#18a058',
    category: 'device',
    description: 'Execute a manual Mijia scene through mi-cli.',
    default_config: { scene_id: '', scene_name: '', home_id: '' },
    config_schema: [
      { key: 'scene_id', label: 'Scene ID', control: 'text' },
      { key: 'scene_name', label: 'Scene Name', control: 'text' },
      { key: 'home_id', label: 'Home ID', control: 'text' },
    ],
    output_schema: [
      { key: 'result', label: 'Result', type: 'object', description: 'Scene execution result payload.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when the scene succeeds.' },
    ],
  },
  {
    type: 'device_capability',
    label: 'Device Capability',
    icon: 'C',
    color: '#2563eb',
    category: 'device',
    description: 'Run a structured device capability through the shared device-agent runtime with rehearsal first.',
    default_config: { device_id: null, capability_id: '', capability: '', arguments: {} },
    config_schema: [
      { key: 'device_id', label: 'Device ID', control: 'text', required: true, helper: 'Accepts a numeric id or a variable template such as {{input.device_id}}.' },
      { key: 'capability_id', label: 'Capability ID', control: 'text', helper: 'Structured capability id such as adb.launch_app or mi.ir_key.' },
      { key: 'capability', label: 'Capability Name', control: 'text', helper: 'Fallback capability name when the id is not known.' },
      { key: 'arguments', label: 'Arguments', control: 'json' },
    ],
    output_schema: [
      { key: 'rehearsal', label: 'Rehearsal', type: 'object', description: 'Sandbox rehearsal result before execution.' },
      { key: 'result', label: 'Result', type: 'object', description: 'Final device-agent execution result or error payload.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when the capability succeeds.' },
    ],
  },
  {
    type: 'llm',
    label: 'LLM',
    icon: 'L',
    color: '#8a2be2',
    category: 'compute',
    description: 'Prompt an LLM model slot and output response text.',
    default_config: { prompt: '', temperature: 0.7 },
    config_schema: [
      { key: 'prompt', label: 'Prompt', control: 'textarea', required: true },
      { key: 'temperature', label: 'Temperature', control: 'number' },
    ],
    output_schema: [
      { key: 'response', label: 'Response', type: 'string', description: 'Model response text.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when inference succeeds.' },
    ],
  },
  {
    type: 'if_else',
    label: 'Condition',
    icon: '?',
    color: '#f0a020',
    category: 'logic',
    description: 'Evaluate boolean expression and route true/false outputs.',
    default_config: { left: '', operator: '==', right: '' },
    config_schema: [
      { key: 'left', label: 'Left', control: 'text' },
      {
        key: 'operator',
        label: 'Operator',
        control: 'select',
        options: [
          { label: '==', value: '==' },
          { label: '!=', value: '!=' },
          { label: '>', value: '>' },
          { label: '<', value: '<' },
          { label: '>=', value: '>=' },
          { label: '<=', value: '<=' },
          { label: 'contains', value: 'contains' },
        ],
      },
      { key: 'right', label: 'Right', control: 'text' },
    ],
    output_schema: [
      { key: 'condition_result', label: 'Condition Result', type: 'boolean', description: 'Evaluated boolean result.' },
      { key: 'true', label: 'True Port', type: 'boolean', description: 'True branch flag.' },
      { key: 'false', label: 'False Port', type: 'boolean', description: 'False branch flag.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when evaluation completes.' },
    ],
  },
  {
    type: 'delay',
    label: 'Delay',
    icon: 'T',
    color: '#909399',
    category: 'control',
    description: 'Pause execution for duration in milliseconds.',
    default_config: { duration: 1000 },
    config_schema: [
      { key: 'duration', label: 'Duration MS', control: 'number', required: true },
    ],
    output_schema: [
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True after the delay completes.' },
    ],
  },
  {
    type: 'parallel',
    label: 'Parallel',
    icon: 'P',
    color: '#2080f0',
    category: 'control',
    description: 'Fan out downstream branches so sibling nodes can execute concurrently.',
    default_config: {},
    config_schema: [],
    output_schema: [
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when downstream parallel branches may start.' },
    ],
  },
  {
    type: 'subflow',
    label: 'Subflow',
    icon: 'F',
    color: '#1f7a4f',
    category: 'control',
    description: 'Run another workflow as child engine and return nested outputs.',
    default_config: {
      workflow_id: null,
      workflow_name: '',
      inputs: {},
      output_key: '',
    },
    config_schema: [
      { key: 'workflow_id', label: 'Workflow ID', control: 'number' },
      { key: 'workflow_name', label: 'Workflow Name', control: 'text' },
      { key: 'inputs', label: 'Inputs', control: 'json' },
      { key: 'output_key', label: 'Output Key', control: 'text' },
    ],
    output_schema: [
      { key: 'subflow', label: 'Subflow Summary', type: 'object', description: 'Child workflow id, run id, status, outputs, and trace count.' },
      { key: 'value', label: 'Selected Value', type: 'unknown', description: 'Optional value selected by output_key.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when the child workflow succeeds.' },
    ],
  },
  {
    type: 'code',
    label: 'Code',
    icon: 'C',
    color: '#333',
    category: 'compute',
    description: 'Run inline JavaScript transform over resolved inputs.',
    default_config: { code: '', inputs: {} },
    config_schema: [
      { key: 'inputs', label: 'Inputs', control: 'json' },
      { key: 'code', label: 'Code', control: 'textarea', required: true },
    ],
    output_schema: [
      { key: 'outputs', label: 'Outputs', type: 'object', description: 'Object returned by the inline JavaScript function.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when the code node succeeds.' },
    ],
  },
  {
    type: 'executor_call',
    label: 'Advanced Runtime Call',
    icon: 'E',
    color: '#18a058',
    category: 'control',
    description: 'Advanced compatibility node for low-level executors. Prefer Device Capability for smart-home actions.',
    default_config: { executor_name: '', params: {} },
    config_schema: [
      { key: 'executor_name', label: 'Executor Name', control: 'text', required: true },
      { key: 'params', label: 'Params', control: 'json' },
    ],
    output_schema: [
      { key: 'result', label: 'Result', type: 'object', description: 'ExecutorGateway result data.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when the executor returns success.' },
    ],
  },
  {
    type: 'knowledge_retrieve',
    label: 'Knowledge Retrieve',
    icon: 'K',
    color: '#0f766e',
    category: 'compute',
    description: 'Retrieve compiled knowledge or memory hits from the shared knowledge base.',
    default_config: { query: '', limit: 5, source: 'search' },
    config_schema: [
      { key: 'query', label: 'Query', control: 'textarea', required: true },
      { key: 'limit', label: 'Limit', control: 'number' },
      {
        key: 'source',
        label: 'Source',
        control: 'select',
        options: [
          { label: 'Search', value: 'search' },
          { label: 'Semantic Search', value: 'semantic' },
          { label: 'Compiled Plans', value: 'compiled_plan' },
          { label: 'All Compiled Knowledge', value: 'compiled' },
        ],
      },
    ],
    output_schema: [
      { key: 'hits', label: 'Hits', type: 'array', description: 'Retrieved knowledge hits.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when retrieval completes.' },
    ],
  },
  {
    type: 'candidate_plan_resolve',
    label: 'Candidate Plan',
    icon: 'R',
    color: '#7c3aed',
    category: 'compute',
    description: 'Resolve structured candidate plans from the shared candidate-plan service.',
    default_config: { query: '', output_key: '' },
    config_schema: [
      { key: 'query', label: 'Query', control: 'textarea', required: true },
      { key: 'output_key', label: 'Output Key', control: 'text', helper: 'Optional top-level field to copy from the best candidate plan.' },
    ],
    output_schema: [
      { key: 'candidate_plan', label: 'Best Candidate Plan', type: 'object', description: 'Top resolved candidate plan.' },
      { key: 'candidate_plans', label: 'Candidate Plans', type: 'array', description: 'Resolved candidate plans ranked by confidence.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when at least one candidate plan is found.' },
    ],
  },
  {
    type: 'rerank_score',
    label: 'Rerank Score',
    icon: 'R',
    color: '#ea580c',
    category: 'compute',
    description: 'Score a set of candidate documents against a query using the shared rerank service.',
    default_config: { query: '', documents: [] },
    config_schema: [
      { key: 'query', label: 'Query', control: 'textarea', required: true },
      { key: 'documents', label: 'Documents', control: 'json', required: true },
    ],
    output_schema: [
      { key: 'ranked', label: 'Ranked Documents', type: 'array', description: 'Documents sorted by score.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when reranking succeeds.' },
    ],
  },
  {
    type: 'agent_dispatch',
    label: 'Capability Dispatch',
    icon: 'G',
    color: '#2563eb',
    category: 'control',
    description: 'Dispatch a structured task to a registered local or remote capability adapter through the shared executor gateway.',
    default_config: { target: '', task: '', payload: {}, execution_mode: 'deferred' },
    config_schema: [
      { key: 'target', label: 'Target', control: 'text', required: true },
      { key: 'task', label: 'Task', control: 'textarea', required: true },
      { key: 'payload', label: 'Payload', control: 'json' },
      {
        key: 'execution_mode',
        label: 'Execution Mode',
        control: 'select',
        options: [
          { label: 'Deferred', value: 'deferred' },
          { label: 'Foreground', value: 'foreground' },
        ],
      },
    ],
    output_schema: [
      { key: 'result', label: 'Result', type: 'object', description: 'Dispatch result payload.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when dispatch succeeds.' },
    ],
  },
  {
    type: 'answer',
    label: 'Answer',
    icon: 'A',
    color: '#d03050',
    category: 'output',
    description: 'Output final answer text from resolved template.',
    default_config: { message: '' },
    config_schema: [
      { key: 'message', label: 'Message', control: 'textarea', required: true },
    ],
    output_schema: [
      { key: 'answer', label: 'Answer', type: 'string', description: 'Final workflow answer text.' },
    ],
  },
  {
    type: 'wait_until',
    label: 'Wait Until',
    icon: 'W',
    color: '#6366f1',
    category: 'control',
    description: 'Poll a device condition until met or timeout. Use between steps that depend on state changes.',
    default_config: { device_id: null, condition: 'app_foreground', expected: '', timeout_ms: 5000, poll_interval_ms: 800 },
    config_schema: [
      { key: 'device_id', label: 'Device ID', control: 'text', required: true },
      {
        key: 'condition',
        label: 'Condition',
        control: 'select',
        required: true,
        options: [
          { label: 'App Foreground', value: 'app_foreground' },
          { label: 'UI Element Visible', value: 'ui_element_visible' },
          { label: 'Device Online', value: 'device_online' },
        ],
      },
      { key: 'expected', label: 'Expected Value', control: 'text', required: true, helper: 'Package name, element text, or "true".' },
      { key: 'timeout_ms', label: 'Timeout (ms)', control: 'number' },
      { key: 'poll_interval_ms', label: 'Poll Interval (ms)', control: 'number' },
    ],
    output_schema: [
      { key: 'met', label: 'Condition Met', type: 'boolean', description: 'True when condition was satisfied before timeout.' },
      { key: 'elapsed_ms', label: 'Elapsed MS', type: 'number', description: 'Time spent waiting.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when condition met.' },
    ],
  },
  {
    type: 'http_request',
    label: 'HTTP Request',
    icon: 'H',
    color: '#0891b2',
    category: 'compute',
    description: 'Make an HTTP request to an external API and return the response.',
    default_config: { url: '', method: 'GET', headers: {}, body: '' },
    config_schema: [
      { key: 'url', label: 'URL', control: 'text', required: true },
      {
        key: 'method',
        label: 'Method',
        control: 'select',
        options: [
          { label: 'GET', value: 'GET' },
          { label: 'POST', value: 'POST' },
          { label: 'PUT', value: 'PUT' },
          { label: 'DELETE', value: 'DELETE' },
        ],
      },
      { key: 'headers', label: 'Headers', control: 'json' },
      { key: 'body', label: 'Body', control: 'textarea' },
    ],
    output_schema: [
      { key: 'status', label: 'Status Code', type: 'number', description: 'HTTP response status code.' },
      { key: 'data', label: 'Response Data', type: 'object', description: 'Parsed JSON response or text.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when request succeeds (2xx).' },
    ],
  },
  {
    type: 'human_input',
    label: 'Human Input',
    icon: 'U',
    color: '#ec4899',
    category: 'control',
    description: 'Pause workflow and wait for user confirmation or input before continuing.',
    default_config: { prompt: '', timeout_seconds: 60 },
    config_schema: [
      { key: 'prompt', label: 'Prompt', control: 'textarea', required: true, helper: 'Question to ask the user.' },
      { key: 'timeout_seconds', label: 'Timeout (seconds)', control: 'number' },
    ],
    output_schema: [
      { key: 'response', label: 'User Response', type: 'string', description: 'Text response from the user.' },
      { key: 'confirmed', label: 'Confirmed', type: 'boolean', description: 'True if user confirmed or responded.' },
      { key: 'trigger', label: 'Trigger', type: 'boolean', description: 'True when user responds.' },
    ],
  },
]

class WorkflowNodeDefinitionRegistry {
  private readonly definitions = new Map<string, WorkflowNodeDefinition>()

  constructor() {
    for (const definition of DEFINITIONS) {
      this.definitions.set(definition.type, definition)
    }
  }

  list(): WorkflowNodeDefinition[] {
    return Array.from(this.definitions.values())
  }

  get(type: string): WorkflowNodeDefinition | undefined {
    return this.definitions.get(type)
  }

  has(type: string): boolean {
    return this.definitions.has(type)
  }
}

export const workflowNodeDefinitionRegistry = new WorkflowNodeDefinitionRegistry()
