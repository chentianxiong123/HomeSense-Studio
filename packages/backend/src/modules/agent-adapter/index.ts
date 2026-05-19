export interface AgentCliAdapterBinding {
  kind: 'cli'
  cli_name: string
  default_action: string
}

export interface AgentA2AAdapterBinding {
  kind: 'a2a'
  endpoint_env?: string
  endpoint_url?: string
  agent_name?: string
}

export type AgentAdapterBinding = AgentCliAdapterBinding | AgentA2AAdapterBinding

export interface AgentAdapterDescriptor {
  id: string
  category: 'coding' | 'automation' | 'media' | 'device'
  transport: 'local_cli' | 'local_agent' | 'remote_bridge' | 'a2a_http'
  display_name: string
  description: string
  enabled: boolean
  status: 'ready' | 'planned' | 'disabled'
  capabilities: string[]
  execution_modes: Array<'deferred' | 'immediate'>
  input_schema: {
    task: 'string'
    payload: 'object'
    execution_mode: Array<'deferred' | 'immediate'>
  }
  input_template: {
    task: string
    payload: Record<string, unknown>
  }
  sample_dispatch: {
    task: string
    payload: Record<string, unknown>
    execution_mode: 'deferred' | 'immediate'
  }
  payload_schema?: Record<string, { type: string; required: boolean; description?: string; default?: unknown }>
  adapter_binding?: AgentAdapterBinding
  runtime_status?: AgentAdapterRuntimeStatus
}

export interface AgentAdapterRuntimeStatus {
  binding_kind: 'cli' | 'a2a' | 'none'
  mode: 'local_ready' | 'a2a_ready' | 'a2a_dry_run' | 'unbound'
  configured: boolean
  endpoint_env?: string
  agent_name?: string
}

class AgentAdapterRegistry {
  private adapters = new Map<string, AgentAdapterDescriptor>()

  initialize(): void {
    this.adapters.clear()

    this.register({
      id: 'codex',
      category: 'coding',
      transport: 'local_agent',
      display_name: 'Codex',
      description: 'General-purpose coding and execution agent adapter for local development tasks.',
      enabled: true,
      status: 'ready',
      capabilities: ['coding', 'analysis', 'repo_ops'],
      execution_modes: ['deferred', 'immediate'],
      input_schema: {
        task: 'string',
        payload: 'object',
        execution_mode: ['deferred', 'immediate'],
      },
      input_template: {
        task: '',
        payload: {},
      },
      sample_dispatch: {
        task: 'Review the current repository and propose a minimal patch plan.',
        payload: { focus: ['architecture', 'tests'] },
        execution_mode: 'deferred',
      },
      payload_schema: {
        focus: { type: 'string[]', required: false, description: '关注点列表，如 architecture/tests/security' },
        scope: { type: 'string', required: false, description: '项目范围提示' },
        dry_run: { type: 'boolean', required: false, default: true, description: '是否仅规划不执行' },
      },
    })

    this.register({
      id: 'claude_code',
      category: 'coding',
      transport: 'local_agent',
      display_name: 'Claude Code',
      description: 'External coding agent adapter for delegated implementation and review tasks.',
      enabled: true,
      status: 'planned',
      capabilities: ['coding', 'review', 'refactor'],
      execution_modes: ['deferred'],
      input_schema: {
        task: 'string',
        payload: 'object',
        execution_mode: ['deferred'],
      },
      input_template: {
        task: '',
        payload: {},
      },
      sample_dispatch: {
        task: 'Refine workflow runtime UX and summarize the delta.',
        payload: { scope: 'frontend' },
        execution_mode: 'deferred',
      },
      payload_schema: {
        scope: { type: 'string', required: false, description: '代码范围（frontend / backend / …）' },
        focus: { type: 'string[]', required: false, description: '评审/重构重点' },
        dry_run: { type: 'boolean', required: false, default: true },
      },
    })

    this.register({
      id: 'openclaw',
      category: 'automation',
      transport: 'local_agent',
      display_name: 'OpenClaw',
      description: 'Desktop automation adapter for local GUI and operator-style control tasks.',
      enabled: true,
      status: 'planned',
      capabilities: ['desktop_control', 'ui_automation', 'operator_flow'],
      execution_modes: ['deferred', 'immediate'],
      input_schema: {
        task: 'string',
        payload: 'object',
        execution_mode: ['deferred', 'immediate'],
      },
      input_template: {
        task: '',
        payload: {},
      },
      sample_dispatch: {
        task: 'Open a desktop app and complete a scripted operator flow.',
        payload: { app: 'browser', checkpoints: 3 },
        execution_mode: 'immediate',
      },
      payload_schema: {
        app: { type: 'string', required: true, description: '目标桌面应用' },
        checkpoints: { type: 'number', required: false, description: '操作检查点数量' },
        dry_run: { type: 'boolean', required: false, default: true },
      },
    })

    this.register({
      id: 'bilibili_cli',
      category: 'media',
      transport: 'local_cli',
      display_name: 'Bilibili CLI',
      description: 'CLI adapter for Bilibili upload, metadata, and workflow-oriented media operations.',
      enabled: true,
      status: 'ready',
      capabilities: ['upload_draft', 'metadata', 'media_pipeline', 'dry_run'],
      execution_modes: ['deferred'],
      input_schema: {
        task: 'string',
        payload: 'object',
        execution_mode: ['deferred'],
      },
      input_template: {
        task: 'Prepare a dry-run upload package for a demo video.',
        payload: {
          title: 'HomeSense Studio demo',
          source_path: './exports/homesense-demo.mp4',
          tags: ['HomeSense', 'AI Agent', 'Smart Home'],
          visibility: 'private',
          dry_run: true,
        },
      },
      sample_dispatch: {
        task: 'Prepare a Bilibili upload draft for a HomeSense demo video.',
        payload: {
          title: 'HomeSense Studio demo',
          source_path: './exports/homesense-demo.mp4',
          tags: ['HomeSense', 'AI Agent', 'Smart Home'],
          visibility: 'private',
          dry_run: true,
        },
        execution_mode: 'deferred',
      },
      adapter_binding: {
        kind: 'cli',
        cli_name: 'bilibili-cli',
        default_action: 'prepare_upload',
      },
      payload_schema: {
        title: { type: 'string', required: true, description: '视频标题' },
        source_path: { type: 'string', required: true, description: '源视频文件路径' },
        description: { type: 'string', required: false, description: '视频简介' },
        tags: { type: 'string[]', required: false, description: '标签列表' },
        visibility: { type: 'string', required: false, default: 'private', description: 'private / public' },
        dry_run: { type: 'boolean', required: false, default: true },
      },
    })

    this.register({
      id: 'mi_adb',
      category: 'device',
      transport: 'local_cli',
      display_name: 'Mi ADB',
      description: 'Android and TV device control adapter for ADB-oriented runtime tasks.',
      enabled: true,
      status: 'ready',
      capabilities: ['adb', 'device_control', 'tv_runtime'],
      execution_modes: ['deferred', 'immediate'],
      input_schema: {
        task: 'string',
        payload: 'object',
        execution_mode: ['deferred', 'immediate'],
      },
      input_template: {
        task: '',
        payload: {},
      },
      sample_dispatch: {
        task: 'Launch the Bilibili TV app on the target device.',
        payload: { package: 'com.xiaodianshi.tv.yst' },
        execution_mode: 'immediate',
      },
      adapter_binding: {
        kind: 'cli',
        cli_name: 'adb-cli',
        default_action: 'launch_app',
      },
      payload_schema: {
        action: { type: 'string', required: true, description: 'launch_app / list_packages / ensure_connected' },
        package: { type: 'string', required: false, description: '安卓包名（launch_app 必填）' },
        max_attempts: { type: 'number', required: false, default: 3 },
        backoff_seconds: { type: 'number', required: false, default: 1 },
      },
    })

    this.register({
      id: 'a2a_codex',
      category: 'coding',
      transport: 'a2a_http',
      display_name: 'Codex A2A',
      description: 'A2A-compatible bridge for dispatching coding tasks to a Codex-style agent endpoint.',
      enabled: true,
      status: 'planned',
      capabilities: ['a2a', 'coding', 'delegation', 'dry_run'],
      execution_modes: ['deferred'],
      input_schema: {
        task: 'string',
        payload: 'object',
        execution_mode: ['deferred'],
      },
      input_template: {
        task: 'Review the current project state and return implementation notes.',
        payload: { scope: 'homesense-studio', mode: 'dry_run' },
      },
      sample_dispatch: {
        task: 'Review the current project state and return implementation notes.',
        payload: { scope: 'homesense-studio', mode: 'dry_run' },
        execution_mode: 'deferred',
      },
      adapter_binding: {
        kind: 'a2a',
        endpoint_env: 'A2A_CODEX_URL',
        agent_name: 'codex',
      },
      payload_schema: {
        scope: { type: 'string', required: false, description: '项目范围' },
        mode: { type: 'string', required: false, default: 'dry_run', description: 'dry_run / live' },
        focus: { type: 'string[]', required: false },
      },
    })

    this.register({
      id: 'a2a_claude_code',
      category: 'coding',
      transport: 'a2a_http',
      display_name: 'Claude Code A2A',
      description: 'A2A-compatible bridge for delegating implementation or review tasks to a Claude Code endpoint.',
      enabled: true,
      status: 'planned',
      capabilities: ['a2a', 'coding', 'review', 'delegation', 'dry_run'],
      execution_modes: ['deferred'],
      input_schema: {
        task: 'string',
        payload: 'object',
        execution_mode: ['deferred'],
      },
      input_template: {
        task: 'Inspect a selected workflow and suggest implementation improvements.',
        payload: { scope: 'workflow-runtime', mode: 'dry_run' },
      },
      sample_dispatch: {
        task: 'Inspect a selected workflow and suggest implementation improvements.',
        payload: { scope: 'workflow-runtime', mode: 'dry_run' },
        execution_mode: 'deferred',
      },
      adapter_binding: {
        kind: 'a2a',
        endpoint_env: 'A2A_CLAUDE_CODE_URL',
        agent_name: 'claude_code',
      },
      payload_schema: {
        scope: { type: 'string', required: false, description: '工作流名/模块/范围' },
        focus: { type: 'string[]', required: false },
        mode: { type: 'string', required: false, default: 'dry_run' },
      },
    })

    this.register({
      id: 'a2a_xiaolongxia',
      category: 'automation',
      transport: 'a2a_http',
      display_name: 'Xiaolongxia A2A',
      description: 'A2A-compatible bridge for scheduling, platform integration, and automation handoff tasks.',
      enabled: true,
      status: 'planned',
      capabilities: ['a2a', 'scheduler', 'platform_bridge', 'automation', 'dry_run'],
      execution_modes: ['deferred', 'immediate'],
      input_schema: {
        task: 'string',
        payload: 'object',
        execution_mode: ['deferred', 'immediate'],
      },
      input_template: {
        task: 'Create or update a scheduled automation task.',
        payload: { schedule: '', platform: '', action: '', mode: 'dry_run' },
      },
      sample_dispatch: {
        task: 'Create a dry-run scheduled task for the HomeSense demo.',
        payload: { schedule: 'daily 20:00', platform: 'homesense', action: 'preview_watch_bilibili', mode: 'dry_run' },
        execution_mode: 'deferred',
      },
      adapter_binding: {
        kind: 'a2a',
        endpoint_env: 'A2A_XIAOLONGXIA_URL',
        agent_name: 'xiaolongxia',
      },
      payload_schema: {
        schedule: { type: 'string', required: true, description: 'cron 或 "daily HH:MM" 等' },
        platform: { type: 'string', required: true, description: '平台标识' },
        action: { type: 'string', required: true, description: '调度动作名' },
        mode: { type: 'string', required: false, default: 'dry_run' },
      },
    })
  }

  register(adapter: AgentAdapterDescriptor): void {
    this.adapters.set(adapter.id, adapter)
  }

  list(): AgentAdapterDescriptor[] {
    return Array.from(this.adapters.values())
      .map((adapter) => this.withRuntimeStatus(adapter))
      .sort((left, right) => left.id.localeCompare(right.id))
  }

  get(id: string): AgentAdapterDescriptor | undefined {
    return this.adapters.get(id)
  }

  listEnabledTargets(): string[] {
    return this.list()
      .filter((adapter) => adapter.enabled)
      .map((adapter) => adapter.id)
  }

  buildDispatchTemplate(target?: string): Record<string, unknown> {
    const resolvedTarget = target && this.adapters.has(target)
      ? target
      : this.listEnabledTargets()[0] ?? 'codex'
    const adapter = this.get(resolvedTarget)
    const executionMode = adapter?.execution_modes[0] ?? 'deferred'
    return {
      target: resolvedTarget,
      task: adapter?.input_template.task ?? '',
      payload: adapter?.input_template.payload ?? {},
      execution_mode: executionMode,
    }
  }

  private withRuntimeStatus(adapter: AgentAdapterDescriptor): AgentAdapterDescriptor {
    const binding = adapter.adapter_binding
    if (!binding) {
      return {
        ...adapter,
        runtime_status: {
          binding_kind: 'none',
          mode: 'unbound',
          configured: false,
        },
      }
    }

    if (binding.kind === 'cli') {
      return {
        ...adapter,
        runtime_status: {
          binding_kind: 'cli',
          mode: 'local_ready',
          configured: true,
        },
      }
    }

    const configured = Boolean(binding.endpoint_url || (binding.endpoint_env && process.env[binding.endpoint_env]))
    return {
      ...adapter,
      runtime_status: {
        binding_kind: 'a2a',
        mode: configured ? 'a2a_ready' : 'a2a_dry_run',
        configured,
        endpoint_env: binding.endpoint_env,
        agent_name: binding.agent_name,
      },
    }
  }
}

export const agentAdapterRegistry = new AgentAdapterRegistry()
