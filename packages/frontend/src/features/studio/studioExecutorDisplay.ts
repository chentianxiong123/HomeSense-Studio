import type { AgentAdapterDescriptor, CLIExecutorDescriptor, ExecutorDescriptor } from '@/api/executor'

type Labeler = (zh: string, en: string) => string

const EXECUTOR_KIND_LABELS: Record<ExecutorDescriptor['kind'], [string, string]> = {
  cli: ['CLI', 'CLI'],
  service: ['服务', 'Service'],
  workflow: ['工作流', 'Workflow'],
  agent: ['能力适配', 'Capability'],
  plan: ['计划', 'Plan'],
}

const CLI_SOURCE_LABELS: Record<CLIExecutorDescriptor['source'], [string, string]> = {
  builtin: ['内建', 'Built-in'],
  third_party: ['第三方', 'Third Party'],
}

const CLI_PROTOCOL_LABELS: Record<CLIExecutorDescriptor['protocol'], [string, string]> = {
  process_json_arg: ['JSON 参数', 'JSON Arg'],
  process_stdin_json: ['标准输入 JSON', 'STDIN JSON'],
  in_process_module: ['进程内模块', 'In-Process Module'],
}

const ADAPTER_CATEGORY_LABELS: Record<AgentAdapterDescriptor['category'], [string, string]> = {
  coding: ['编码', 'Coding'],
  automation: ['自动化', 'Automation'],
  media: ['媒体', 'Media'],
  device: ['设备', 'Device'],
}

const ADAPTER_TRANSPORT_LABELS: Record<AgentAdapterDescriptor['transport'], [string, string]> = {
  local_cli: ['本地 CLI', 'Local CLI'],
  local_agent: ['本地 Agent', 'Local Agent'],
  remote_bridge: ['远程桥接', 'Remote Bridge'],
  a2a_http: ['远程 HTTP', 'Remote HTTP'],
}

const ADAPTER_STATUS_LABELS: Record<AgentAdapterDescriptor['status'], [string, string]> = {
  ready: ['就绪', 'Ready'],
  planned: ['规划中', 'Planned'],
  disabled: ['停用', 'Disabled'],
}

const ADAPTER_MODE_LABELS: Record<NonNullable<AgentAdapterDescriptor['runtime_status']>['mode'], [string, string]> = {
  local_ready: ['本地就绪', 'Local Ready'],
  a2a_ready: ['远程就绪', 'Remote Ready'],
  a2a_dry_run: ['远程演练', 'Remote Dry Run'],
  unbound: ['未绑定', 'Unbound'],
}

export function formatExecutorKind(kind: ExecutorDescriptor['kind'], label: Labeler): string {
  return label(...EXECUTOR_KIND_LABELS[kind])
}

export function formatCliExecutorSource(source: CLIExecutorDescriptor['source'], label: Labeler): string {
  return label(...CLI_SOURCE_LABELS[source])
}

export function formatCliExecutorProtocol(protocol: CLIExecutorDescriptor['protocol'], label: Labeler): string {
  return label(...CLI_PROTOCOL_LABELS[protocol])
}

export function formatAgentAdapterCategory(category: AgentAdapterDescriptor['category'], label: Labeler): string {
  return label(...ADAPTER_CATEGORY_LABELS[category])
}

export function formatAgentAdapterTransport(transport: AgentAdapterDescriptor['transport'], label: Labeler): string {
  return label(...ADAPTER_TRANSPORT_LABELS[transport])
}

export function formatAgentAdapterStatus(status: AgentAdapterDescriptor['status'], label: Labeler): string {
  return label(...ADAPTER_STATUS_LABELS[status])
}

export function formatAgentAdapterMode(mode: NonNullable<AgentAdapterDescriptor['runtime_status']>['mode'], label: Labeler): string {
  return label(...ADAPTER_MODE_LABELS[mode])
}
