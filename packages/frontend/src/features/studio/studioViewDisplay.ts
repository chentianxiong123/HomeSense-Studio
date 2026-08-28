type Labeler = (zh: string, en: string) => string

const SHOWCASE_BADGES: Record<string, [string, string]> = {
  Hero: ['主线', 'Hero'],
  Studio: ['工作台', 'Studio'],
  Capability: ['设备能力', 'Capability'],
  Subflow: ['子流程', 'Subflow'],
  Adapter: ['本地能力', 'Adapter'],
  Memory: ['记忆', 'Memory'],
}

const SHOWCASE_EYEBROWS: Record<string, [string, string]> = {
  'Family Entertainment': ['家庭娱乐', 'Family Entertainment'],
  'Content Pipeline': ['内容流水线', 'Content Pipeline'],
  'Reusable Runtime': ['可复用运行时', 'Reusable Runtime'],
  'Local Capability': ['本地能力', 'Local Capability'],
  'Sandbox Rehearsal': ['沙箱演练', 'Sandbox Rehearsal'],
  'Candidate Routing': ['候选路由', 'Candidate Routing'],
}

const VARIABLE_SOURCES: Record<string, [string, string]> = {
  'workflow input': ['工作流输入', 'Workflow Input'],
  start: ['开始节点', 'Start Node'],
  device_control: ['设备控制', 'Device Control'],
  device_capability: ['设备能力', 'Device Capability'],
  xiaoai: ['小爱音箱', 'XiaoAi'],
  ir_control: ['红外控制', 'IR Control'],
  llm: ['LLM', 'LLM'],
  if_else: ['条件分支', 'If / Else'],
  delay: ['延迟', 'Delay'],
  parallel: ['并行', 'Parallel'],
  subflow: ['子流程', 'Subflow'],
  code: ['代码节点', 'Code'],
  executor_call: ['高级调用', 'Advanced Call'],
  answer: ['回答节点', 'Answer'],
}

const CAPABILITIES: Record<string, [string, string]> = {
  agent: ['能力适配', 'Capability'],
  adapter: ['适配器', 'Adapter'],
  delegation: ['委派', 'Delegation'],
  dry_run: ['演练', 'Dry Run'],
  packages: ['包列表', 'Packages'],
  launch_app: ['启动应用', 'Launch App'],
  list_packages: ['读取包列表', 'List Packages'],
  device: ['设备', 'Device'],
  external: ['外部', 'External'],
  media: ['媒体', 'Media'],
}

const EXECUTION_MODES: Record<string, [string, string]> = {
  deferred: ['排队执行', 'Deferred'],
  immediate: ['立即执行', 'Immediate'],
}

const BINDING_KINDS: Record<string, [string, string]> = {
  cli: ['CLI', 'CLI'],
  a2a: ['远程桥接', 'Remote Bridge'],
  none: ['未绑定', 'None'],
}

const VARIABLE_MODES: Record<string, [string, string]> = {
  text: ['文本', 'Text'],
  json: ['JSON', 'JSON'],
}

export function formatShowcaseBadge(value: string, label: Labeler): string {
  const names = SHOWCASE_BADGES[value]
  return names ? localize(names[0], names[1], label) : value
}

export function formatShowcaseEyebrow(value: string, label: Labeler): string {
  const names = SHOWCASE_EYEBROWS[value]
  return names ? localize(names[0], names[1], label) : value
}

export function formatVariableSource(value: string, label: Labeler): string {
  const names = VARIABLE_SOURCES[value]
  return names ? localize(names[0], names[1], label) : value
}

export function formatCapability(value: string, label: Labeler): string {
  const names = CAPABILITIES[value]
  return names ? localize(names[0], names[1], label) : value
}

export function formatExecutionMode(value: string, label: Labeler): string {
  const names = EXECUTION_MODES[value]
  return names ? localize(names[0], names[1], label) : value
}

export function formatBindingKind(value: string, label: Labeler): string {
  const names = BINDING_KINDS[value]
  return names ? localize(names[0], names[1], label) : value
}

export function formatVariableMode(value: string, label: Labeler): string {
  const names = VARIABLE_MODES[value]
  return names ? localize(names[0], names[1], label) : value
}

function localize(zh: string, en: string, label: Labeler): string {
  return zh === en ? zh : label(zh, en)
}
