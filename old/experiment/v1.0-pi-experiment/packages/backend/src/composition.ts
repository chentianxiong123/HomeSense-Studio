import { getDb } from './db/index.js'
import { eventBus } from './modules/event-bus/index.js'
import { llmService } from './modules/llm-provider/service.js'
import { memoryKernel } from './modules/memory-kernel/index.js'
import { planLibrary } from './modules/plan-library/index.js'
import { knowledgeCompiler } from './modules/knowledge-compiler/index.js'
import { experienceService } from './modules/experience/index.js'
import { skillsService } from './modules/skills-system/index.js'
import { agentInstanceService } from './modules/agent-instance/index.js'
import { agentAdapterRegistry } from './modules/agent-adapter/index.js'
import { cliBridge } from './modules/cli-bridge/index.js'
import { executorGateway } from './modules/executor-gateway/index.js'
import { ruleEngine } from './modules/rule-engine/index.js'
import { workflowSeedService } from './modules/workflow/seed.js'

export interface EventBusInstance {
  fire(eventType: string, data?: unknown): void | Promise<void>
  on(eventType: string, handler: (...args: unknown[]) => void): () => void
}

export interface Container {
  db: ReturnType<typeof getDb>
  eventBus: typeof eventBus
  llmService: typeof llmService
  memoryKernel: typeof memoryKernel
  planLibrary: typeof planLibrary
  knowledgeCompiler: typeof knowledgeCompiler
  experienceService: typeof experienceService
  skillsService: typeof skillsService
  agentInstanceService: typeof agentInstanceService
  agentAdapterRegistry: typeof agentAdapterRegistry
  cliBridge: typeof cliBridge
  executorGateway: typeof executorGateway
  ruleEngine: typeof ruleEngine
  workflowSeedService: typeof workflowSeedService
}

export function buildContainer(deps?: { db?: ReturnType<typeof getDb> }): Container {
  const db = deps?.db ?? getDb()

  return {
    db,
    eventBus,
    llmService,
    memoryKernel,
    planLibrary,
    knowledgeCompiler,
    experienceService,
    skillsService,
    agentInstanceService,
    agentAdapterRegistry,
    cliBridge,
    executorGateway,
    ruleEngine,
    workflowSeedService,
  }
}