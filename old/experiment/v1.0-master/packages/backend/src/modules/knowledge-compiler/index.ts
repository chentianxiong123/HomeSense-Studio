import fs from 'fs'
import { memoryKernel as defaultMemoryKernel } from '../memory-kernel/index.js'
import { planLibrary as defaultPlanLibrary } from '../plan-library/index.js'
import { SqlKnowledgeCompilerRepository, type KnowledgeCompilerRepository, type CompilerExperiencePathRow } from './repository.js'

interface MemoryKernelInstance {
  upsertCompiledKnowledge(params: {
    kind: string
    title: string
    body: string
    wing?: string
    room?: string
    source_type: string
    source_ref: string
    tags?: string[]
    metadata?: Record<string, unknown>
    rank_score?: number
  }): void
}

interface PlanLibraryInstance {
  listPlans(): Array<{
    id: string
    name: string
    intent?: string
    input?: string
    steps: Array<{ tool: string; action: string; params: Record<string, unknown> }>
  }>
}

export interface FileReader {
  readFile(filePath: string): string
}

export class FsFileReader implements FileReader {
  readFile(filePath: string): string {
    try {
      return fs.readFileSync(filePath, 'utf-8')
    } catch {
      return ''
    }
  }
}

export class KnowledgeCompilerService {
  constructor(
    private readonly repo: KnowledgeCompilerRepository = new SqlKnowledgeCompilerRepository(),
    private readonly memoryKernel: MemoryKernelInstance = defaultMemoryKernel,
    private readonly planLibrary: PlanLibraryInstance = defaultPlanLibrary,
    private readonly files: FileReader = new FsFileReader(),
  ) {}

  refreshKnowledge(): {
    entity_pages: number
    experience_notes: number
    compiled_plans: number
    workflow_candidates: number
    experience_paths: number
  } {
    const entityPages = this.compileEntityPages()
    const experienceNotes = this.compileExperienceNotes()
    const compiledPlans = this.compileExperiencePlans() + this.compileLibraryPlans()
    const workflowCandidates = this.compileWorkflowCandidates()
    const experiencePaths = this.compileExperiencePaths()

    return {
      entity_pages: entityPages,
      experience_notes: experienceNotes,
      compiled_plans: compiledPlans,
      workflow_candidates: workflowCandidates,
      experience_paths: experiencePaths,
    }
  }

  private compileEntityPages(): number {
    const entities = this.repo.listAllEntities()

    for (const entity of entities) {
      const attributes = this.repo.listAttributesForEntity(entity.id)
      const triples = this.repo.listTriplesForEntity(entity.id, 8)

      const properties = safeParse<Record<string, unknown>>(entity.properties_json ?? '{}', {})
      const title = `${entity.name} (${entity.type})`
      const bodyLines = [
        `Entity: ${entity.name}`,
        `Type: ${entity.type}`,
        `Wing: ${entity.wing || 'n/a'}`,
        `Room: ${entity.room || 'n/a'}`,
      ]

      if (typeof properties.content === 'string' && properties.content) {
        bodyLines.push('', properties.content)
      }

      if (attributes.length > 0) {
        bodyLines.push('', 'Attributes:')
        for (const attribute of attributes) {
          bodyLines.push(`- ${attribute.key}: ${attribute.value}`)
        }
      }

      if (triples.length > 0) {
        bodyLines.push('', 'Relations:')
        for (const triple of triples) {
          bodyLines.push(`- ${triple.subject_name} ${triple.predicate} ${triple.object_name}`)
        }
      }

      this.memoryKernel.upsertCompiledKnowledge({
        kind: 'wiki_page',
        title,
        body: bodyLines.join('\n').trim(),
        wing: entity.wing,
        room: entity.room,
        source_type: 'memory_entity',
        source_ref: entity.id,
        tags: [entity.type, entity.wing].filter(Boolean),
        metadata: {
          entity_id: entity.id,
          type: entity.type,
        },
        rank_score: 0.72,
      })
    }

    return entities.length
  }

  private compileExperienceNotes(): number {
    const experiences = this.repo.listAllExperiencesByImportance()

    for (const experience of experiences) {
      const content = this.readExperienceBody(experience.file_path)
      this.memoryKernel.upsertCompiledKnowledge({
        kind: 'experience_note',
        title: experience.title,
        body: content,
        wing: experience.category,
        source_type: 'experience',
        source_ref: String(experience.id),
        tags: ['experience', experience.category],
        metadata: {
          experience_id: experience.id,
          importance: experience.importance,
          file_path: experience.file_path,
        },
        rank_score: Math.max(0.45, Math.min(0.95, experience.importance)),
      })
    }

    return experiences.length
  }

  private compileExperiencePlans(): number {
    const experiences = this.repo.listExperiencesAboveImportance(0.7)

    for (const experience of experiences) {
      const content = this.readExperienceBody(experience.file_path)
      const planLines = this.extractPlanLines(content)
      if (planLines.length === 0) continue

      this.memoryKernel.upsertCompiledKnowledge({
        kind: 'compiled_plan',
        title: `Plan: ${experience.title}`,
        body: planLines.join('\n'),
        wing: experience.category,
        source_type: 'experience_plan',
        source_ref: String(experience.id),
        tags: ['plan', experience.category],
        metadata: {
          experience_id: experience.id,
          derived_from: 'experience',
        },
        rank_score: Math.max(0.72, Math.min(0.98, experience.importance)),
      })
    }

    return experiences.length
  }

  private compileWorkflowCandidates(): number {
    const workflows = this.repo.listAllWorkflows()

    for (const workflow of workflows) {
      const graph = safeParse<{ nodes?: Array<{ type?: string; label?: string }> }>(
        workflow.graph_json ?? '{}',
        {},
      )
      const nodeSummary = (graph.nodes ?? []).map((node) => `${node.label ?? node.type ?? 'node'}`).join(' -> ')

      this.memoryKernel.upsertCompiledKnowledge({
        kind: 'workflow_candidate',
        title: `Workflow: ${workflow.name}`,
        body: [
          `Description: ${workflow.description || 'n/a'}`,
          `Trigger: ${workflow.trigger_type ?? 'manual'}`,
          nodeSummary ? `Nodes: ${nodeSummary}` : '',
        ].filter(Boolean).join('\n'),
        source_type: 'workflow',
        source_ref: String(workflow.id),
        tags: ['workflow', workflow.trigger_type ?? 'manual'],
        metadata: {
          workflow_id: workflow.id,
          published: workflow.published === 1,
        },
        rank_score: workflow.published === 1 ? 0.8 : 0.6,
      })
    }

    return workflows.length
  }

  private compileLibraryPlans(): number {
    const plans = this.planLibrary.listPlans()
    for (const plan of plans) {
      const bodyLines = [
        `Intent: ${plan.intent || 'n/a'}`,
        `Input: ${plan.input || 'n/a'}`,
        '',
        'Steps:',
        ...plan.steps.map((step, index) => `${index + 1}. ${step.tool}.${step.action} ${JSON.stringify(step.params)}`),
      ]

      this.memoryKernel.upsertCompiledKnowledge({
        kind: 'compiled_plan',
        title: `Plan: ${plan.name}`,
        body: bodyLines.join('\n'),
        wing: 'home.entertainment',
        room: 'living_room',
        source_type: 'legacy_success_path',
        source_ref: plan.id,
        tags: ['legacy-plan', plan.intent || plan.name],
        metadata: {
          plan_id: plan.id,
          name: plan.name,
          intent: plan.intent,
          input: plan.input,
          steps: plan.steps,
        },
        rank_score: 0.92,
      })
    }

    return plans.length
  }

  private extractPlanLines(content: string): string[] {
    const lines = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)

    const planLines = lines.filter((line) => /^\d+\./.test(line) || /^[-*]\s+/.test(line))
    if (planLines.length > 0) return planLines

    return lines
      .filter((line) => /\b(adb|launch|package|tv|bilibili|open|power|remote)\b/i.test(line))
      .slice(0, 12)
  }

  private readExperienceBody(filePath: string): string {
    const raw = this.files.readFile(filePath)
    if (!raw) return ''
    const bodyStart = raw.indexOf('---', raw.indexOf('---') + 3)
    return bodyStart === -1 ? raw.trim() : raw.slice(bodyStart + 3).trim()
  }

  private compileExperiencePaths(): number {
    const paths = this.repo.listActiveExperiencePaths(100)
    let count = 0

    for (const path of paths) {
      const metadata = safeParse<Record<string, unknown>>(path.metadata_json ?? '{}', {})
      const steps = safeParse<Array<{ tool: string; action: string; params?: Record<string, unknown> }>>(path.steps_json ?? '[]', [])
      const successCount = path.success_count ?? 0
      const failureCount = path.failure_count ?? 0
      const totalRuns = successCount + failureCount
      const successRate = totalRuns > 0 ? successCount / totalRuns : 0.5
      const rankScore = Math.min(0.98, Math.max(0.35, path.confidence * 0.6 + successRate * 0.3 + Math.min(0.1, totalRuns * 0.02)))

      const bodyLines = [
        `Intent: ${path.intent_pattern || path.title}`,
        `Summary: ${path.summary || ''}`,
        `Success: ${successCount}/${totalRuns} (${(successRate * 100).toFixed(0)}%)`,
        '',
        'Steps:',
        ...steps.map((step, index) => `${index + 1}. ${step.tool}.${step.action} ${JSON.stringify(step.params ?? {})}`),
      ]

      this.memoryKernel.upsertCompiledKnowledge({
        kind: 'compiled_plan',
        title: path.title,
        body: bodyLines.join('\n'),
        wing: 'runtime_observations',
        room: '',
        source_type: 'runtime_path',
        source_ref: path.id,
        tags: ['runtime-path', path.intent_pattern || ''].filter(Boolean),
        metadata: {
          ...metadata,
          runtime_path_id: path.id,
          intent_pattern: path.intent_pattern,
          steps,
          success_count: successCount,
          failure_count: failureCount,
          success_rate: successRate,
        },
        rank_score: rankScore,
      })
      count++
    }

    return count
  }
}

function safeParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export const knowledgeCompiler = new KnowledgeCompilerService()
