import { cliBridge as defaultCliBridge, type CLIResult, type CLIBridge } from '../integration/index.js'
import { agentAdapterRegistry as defaultAgentAdapterRegistry, type AgentCliAdapterBinding } from '../agent-adapter/index.js'
import { serviceRegistry as defaultServiceRegistry } from '../registry/index.js'
import { planLibrary as defaultPlanLibrary, type CompiledPlanDefinition, type PlanStepDefinition } from '../plan/index.js'
import { memoryKernel as defaultMemoryKernel } from '../memory/index.js'

interface ServiceRegistryInstance {
  call(serviceName: string, params: Record<string, unknown>): Promise<unknown>
}

interface PlanLibraryInstance {
  listPlans(): CompiledPlanDefinition[]
  getPlan(id: string): CompiledPlanDefinition | undefined
}

interface WorkflowRuntimeInstance {
  runWorkflow(id: number, inputs: Record<string, unknown>): Promise<unknown>
}

interface MemoryKernelInstance {
  observeOutcome(observation: {
    intent: string
    tool: string
    action: string
    success: boolean
    error?: string
  }): void
}

type AgentAdapterRegistryInstance = Pick<import('../agent-adapter/index.js').AgentAdapterRegistry, 'listEnabledTargets' | 'buildDispatchTemplate' | 'get'>

export type ExecutorKind = 'cli' | 'service' | 'workflow' | 'agent' | 'plan'

export interface ExecutorDescriptor {
  name: string
  kind: ExecutorKind
  description: string
  enabled: boolean
  capabilities: string[]
  metadata?: Record<string, unknown>
}

export interface ExecutorInvokeResult {
  status: 'success' | 'error'
  executor: string
  data?: unknown
  error?: string
  message?: string
}

export interface PlanPreviewStep {
  order: number
  tool: string
  action: string
  params: Record<string, unknown>
  proposed_executor: string | null
  supported: boolean
}

export interface PlanPreview {
  plan: CompiledPlanDefinition
  steps: PlanPreviewStep[]
  executable: boolean
}

interface RegisteredExecutor {
  descriptor: ExecutorDescriptor
  handler?: (params: Record<string, unknown>) => Promise<unknown>
}

export class ExecutorGatewayService {
  private registry = new Map<string, RegisteredExecutor>()
  private workflowRuntime: WorkflowRuntimeInstance | null = null

  constructor(
    private readonly cliBridge: CLIBridge = defaultCliBridge,
    private readonly agentAdapterRegistry: AgentAdapterRegistryInstance = defaultAgentAdapterRegistry,
    private readonly serviceRegistry: ServiceRegistryInstance = defaultServiceRegistry,
    private readonly planLibrary: PlanLibraryInstance = defaultPlanLibrary,
    private readonly memoryKernel: MemoryKernelInstance = defaultMemoryKernel,
  ) {}

  async initialize(): Promise<void> {
    this.registry.clear()
    const { workflowRuntime } = await import('../workflow/run-workflow.js')
    this.workflowRuntime = workflowRuntime

    this.register({
      name: 'cli.invoke',
      kind: 'cli',
      description: 'Invoke a registered CLI executor by name and action.',
      enabled: true,
      capabilities: ['invoke', 'cli'],
      metadata: {
        transport: 'local_cli_bridge',
        param_template: {
          cli_name: 'adb-cli',
          action: 'list_packages',
          params: {},
        },
      },
    }, async (params) => {
      const cliName = String(params.cli_name ?? '')
      const action = String(params.action ?? '')
      if (!cliName || !action) {
        throw new Error('cli_name and action are required')
      }
      const cliParams = (params.params as Record<string, unknown>) ?? {}
      return this.cliBridge.run(cliName, action, cliParams)
    })

    this.register({
      name: 'service.invoke',
      kind: 'service',
      description: 'Invoke a registered backend service by name.',
      enabled: true,
      capabilities: ['invoke', 'service'],
      metadata: {
        transport: 'in_process_service',
        param_template: {
          service_name: '',
          params: {},
        },
      },
    }, async (params) => {
      const serviceName = String(params.service_name ?? '')
      if (!serviceName) {
        throw new Error('service_name is required')
      }
      const serviceParams = (params.params as Record<string, unknown>) ?? {}
      return this.serviceRegistry.call(serviceName, serviceParams)
    })

    this.register({
      name: 'workflow.run',
      kind: 'workflow',
      description: 'Run a workflow by id through WorkflowRuntime.',
      enabled: true,
      capabilities: ['invoke', 'workflow'],
      metadata: {
        transport: 'workflow_runtime',
        param_template: {
          workflow_id: 1,
          inputs: {},
        },
      },
    }, async (params) => {
      const workflowId = Number(params.workflow_id)
      if (!Number.isFinite(workflowId)) {
        throw new Error('workflow_id must be a number')
      }
      const inputs = (params.inputs as Record<string, unknown>) ?? {}
      return this.workflowRuntime!.runWorkflow(workflowId, inputs)
    })

    this.register({
      name: 'agent.dispatch',
      kind: 'agent',
      description: 'Dispatch a structured task envelope to a registered local capability adapter.',
      enabled: true,
      capabilities: ['device', 'adapter', 'dry_run'],
      metadata: {
        mode: 'dry_run',
        supported_targets: this.agentAdapterRegistry.listEnabledTargets(),
        param_template: this.agentAdapterRegistry.buildDispatchTemplate(),
      },
    }, async (params) => {
      const target = String(params.target ?? '')
      const task = String(params.task ?? '')
      const payload = (params.payload as Record<string, unknown>) ?? {}
      const executionMode = String(params.execution_mode ?? 'deferred')

      if (!target) {
        throw new Error('target is required')
      }
      if (!task) {
        throw new Error('task is required')
      }

      const adapter = this.agentAdapterRegistry.get(target)
      const adapterResult = adapter?.adapter_binding?.kind === 'cli'
        ? await this.dispatchCliAdapter(adapter.adapter_binding, payload)
        : null

      return {
        dispatch_id: `dispatch_${Date.now()}`,
        status: adapterResult ? 'executed' : 'planned',
        target,
        task,
        payload,
        execution_mode: executionMode,
        adapter_result: adapterResult ?? undefined,
        accepted_at: new Date().toISOString(),
      }
    })

    this.register({
      name: 'plan.run',
      kind: 'plan',
      description: 'Run a named compiled plan through mapped executors.',
      enabled: true,
      capabilities: ['plan', 'invoke'],
      metadata: {
        transport: 'compiled_plan_runtime',
        param_template: {
          plan_id: 'path_demo_watch_bilibili',
        },
      },
    }, async (params) => {
      const planId = String(params.plan_id ?? '')
      if (!planId) {
        throw new Error('plan_id is required')
      }
      return this.runPlan(planId)
    })
  }

  register(descriptor: ExecutorDescriptor, handler?: (params: Record<string, unknown>) => Promise<unknown>): void {
    this.registry.set(descriptor.name, { descriptor, handler })
  }

  listExecutors(): ExecutorDescriptor[] {
    return Array.from(this.registry.values())
      .map((entry) => entry.descriptor)
      .sort((left, right) => left.name.localeCompare(right.name))
  }

  async invoke(name: string, params: Record<string, unknown>): Promise<ExecutorInvokeResult> {
    const entry = this.registry.get(name)
    if (!entry) {
      return { status: 'error', executor: name, error: 'EXECUTOR_NOT_FOUND', message: `Executor not found: ${name}` }
    }
    if (!entry.descriptor.enabled || !entry.handler) {
      return { status: 'error', executor: name, error: 'EXECUTOR_DISABLED', message: `Executor not enabled: ${name}` }
    }

    try {
      const data = await entry.handler(params)
      return { status: 'success', executor: name, data }
    } catch (error) {
      return {
        status: 'error',
        executor: name,
        error: 'EXECUTOR_ERROR',
        message: (error as Error).message,
      }
    }
  }

  listPlans(): CompiledPlanDefinition[] {
    return this.planLibrary.listPlans()
  }

  getPlan(id: string): CompiledPlanDefinition | undefined {
    return this.planLibrary.getPlan(id)
  }

  previewPlan(id: string): PlanPreview | null {
    const plan = this.getPlan(id)
    if (!plan) return null

    const steps = plan.steps.map((step, index) => {
      const proposedExecutor = this.resolveStepExecutor(step)
      return {
        order: index + 1,
        tool: step.tool,
        action: step.action,
        params: step.params,
        proposed_executor: proposedExecutor,
        supported: Boolean(proposedExecutor),
      }
    })

    return {
      plan,
      steps,
      executable: steps.every((step) => step.supported),
    }
  }

  async runPlan(id: string): Promise<{
    plan_id: string
    executable: boolean
    results: Array<{
      order: number
      tool: string
      action: string
      executor: string | null
      status: 'success' | 'error' | 'skipped'
      result?: unknown
      error?: string
    }>
  }> {
    const preview = this.previewPlan(id)
    if (!preview) {
      throw new Error(`Plan not found: ${id}`)
    }

    const results: Array<{
      order: number
      tool: string
      action: string
      executor: string | null
      status: 'success' | 'error' | 'skipped'
      result?: unknown
      error?: string
    }> = []

    for (const step of preview.steps) {
      if (!step.proposed_executor) {
        results.push({
          order: step.order,
          tool: step.tool,
          action: step.action,
          executor: null,
          status: 'error',
          error: 'No executor mapping available yet',
        })
        continue
      }

      if (step.proposed_executor.startsWith('cli:')) {
        const cliName = step.proposed_executor.slice(4)
        const result = await this.cliBridge.run(cliName, step.action, step.params)
        results.push({
          order: step.order,
          tool: step.tool,
          action: step.action,
          executor: step.proposed_executor,
          status: result.status === 'success' ? 'success' : 'error',
          result,
          error: result.status === 'error' ? result.message ?? result.error : undefined,
        })
        try {
          this.memoryKernel.observeOutcome({
            intent: `plan.${id}.step.${step.order}`,
            tool: step.tool,
            action: step.action,
            success: result.status === 'success',
            error: result.status === 'error' ? result.message ?? result.error : undefined,
          })
        } catch {}
        if (result.status === 'error') break
        continue
      }

      results.push({
        order: step.order,
        tool: step.tool,
        action: step.action,
        executor: step.proposed_executor,
        status: 'skipped',
        error: 'Executor kind not runnable yet',
      })
      break
    }

    return {
      plan_id: id,
      executable: preview.executable,
      results,
    }
  }

  private resolveStepExecutor(step: PlanStepDefinition): string | null {
    if (step.tool === 'adb') {
      return this.cliBridge.hasExecutor('adb-cli') ? 'cli:adb-cli' : null
    }
    if (step.tool === 'mi-cli') {
      return this.cliBridge.hasExecutor('mi-cli') ? 'cli:mi-cli' : null
    }
    if (this.cliBridge.hasExecutor(step.tool)) {
      return `cli:${step.tool}`
    }
    return null
  }

  private async dispatchCliAdapter(
    binding: AgentCliAdapterBinding,
    payload: Record<string, unknown>,
  ): Promise<CLIResult | null> {
    const action = typeof payload.action === 'string'
      ? payload.action
      : binding.default_action
    const { action: _action, ...cliPayload } = payload
    return this.cliBridge.run(binding.cli_name, action, cliPayload)
  }
}

export const executorGateway = new ExecutorGatewayService()
export const defaultExecutorGateway = executorGateway
export type { ServiceRegistryInstance, PlanLibraryInstance, WorkflowRuntimeInstance, MemoryKernelInstance, AgentAdapterRegistryInstance }
