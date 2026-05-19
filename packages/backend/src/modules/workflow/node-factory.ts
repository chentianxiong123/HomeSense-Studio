import { UnknownWorkflowNode, WorkflowNodeBase, type WorkflowNodeDependencies } from './node-base.js'
import {
  AnswerWorkflowNode,
  CodeWorkflowNode,
  CandidatePlanResolveWorkflowNode,
  DelayWorkflowNode,
  DeviceControlWorkflowNode,
  ExecutorCallWorkflowNode,
  AgentDispatchWorkflowNode,
  IfElseWorkflowNode,
  IRControlWorkflowNode,
  KnowledgeRetrieveWorkflowNode,
  LLMWorkflowNode,
  ParallelWorkflowNode,
  RerankScoreWorkflowNode,
  SceneExecuteWorkflowNode,
  SubflowWorkflowNode,
  StartWorkflowNode,
  XiaoAiWorkflowNode,
} from './built-in-nodes.js'
import { workflowNodeDefinitionRegistry } from './node-definitions.js'
import { cliBridge } from '../cli-bridge/index.js'
import { candidatePlanService } from '../candidate-plan/index.js'
import { executorGateway } from '../executor-gateway/index.js'
import { llmService } from '../llm-provider/service.js'
import { memoryKernel } from '../memory-kernel/index.js'
import { rerankService } from '../rerank-service/index.js'
import type { WorkflowNode } from './types.js'

type WorkflowNodeConstructor = new (node: WorkflowNode, deps: WorkflowNodeDependencies) => WorkflowNodeBase

class WorkflowNodeFactory {
  private readonly registry = new Map<string, WorkflowNodeConstructor>()

  constructor(private readonly deps: WorkflowNodeDependencies = defaultDependencies()) {}

  register(type: string, ctor: WorkflowNodeConstructor): void {
    this.registry.set(type, ctor)
  }

  create(node: WorkflowNode): WorkflowNodeBase {
    const Ctor = this.registry.get(node.type) ?? UnknownWorkflowNode
    return new Ctor(node, this.deps)
  }

  listRegisteredTypes(): string[] {
    return Array.from(this.registry.keys()).sort()
  }
}

function defaultDependencies(): WorkflowNodeDependencies {
  return {
    cliBridge,
    executorGateway,
    llmService,
    memoryKernel,
    candidatePlanService,
    rerankService,
  }
}

export const workflowNodeFactory = new WorkflowNodeFactory()

workflowNodeFactory.register('start', StartWorkflowNode)
workflowNodeFactory.register('device_control', DeviceControlWorkflowNode)
workflowNodeFactory.register('xiaoai', XiaoAiWorkflowNode)
workflowNodeFactory.register('ir_control', IRControlWorkflowNode)
workflowNodeFactory.register('scene_execute', SceneExecuteWorkflowNode)
workflowNodeFactory.register('llm', LLMWorkflowNode)
workflowNodeFactory.register('if_else', IfElseWorkflowNode)
workflowNodeFactory.register('delay', DelayWorkflowNode)
workflowNodeFactory.register('parallel', ParallelWorkflowNode)
workflowNodeFactory.register('subflow', SubflowWorkflowNode)
workflowNodeFactory.register('code', CodeWorkflowNode)
workflowNodeFactory.register('answer', AnswerWorkflowNode)
workflowNodeFactory.register('executor_call', ExecutorCallWorkflowNode)
workflowNodeFactory.register('knowledge_retrieve', KnowledgeRetrieveWorkflowNode)
workflowNodeFactory.register('candidate_plan_resolve', CandidatePlanResolveWorkflowNode)
workflowNodeFactory.register('rerank_score', RerankScoreWorkflowNode)
workflowNodeFactory.register('agent_dispatch', AgentDispatchWorkflowNode)

export function assertWorkflowNodeRegistryIntegrity(): void {
  const runtimeTypes = new Set(workflowNodeFactory.listRegisteredTypes())
  const definitionTypes = new Set(workflowNodeDefinitionRegistry.list().map((definition) => definition.type))

  const missingInRuntime = Array.from(definitionTypes).filter((type) => !runtimeTypes.has(type)).sort()
  const missingInDefinitions = Array.from(runtimeTypes).filter((type) => !definitionTypes.has(type)).sort()

  if (missingInRuntime.length === 0 && missingInDefinitions.length === 0) return

  const messages: string[] = []
  if (missingInRuntime.length > 0) {
    messages.push(`missing runtime nodes: ${missingInRuntime.join(', ')}`)
  }
  if (missingInDefinitions.length > 0) {
    messages.push(`missing node definitions: ${missingInDefinitions.join(', ')}`)
  }

  throw new Error(`Workflow node registry mismatch: ${messages.join(' | ')}`)
}
