import fs from 'fs'
import { getDb } from '../../db/index.js'
import { memoryKernel } from '../memory-kernel/index.js'
import { planLibrary } from '../plan-library/index.js'

interface ExperienceRow {
  id: number
  category: string
  title: string
  file_path: string
  importance: number
}

class KnowledgeCompilerService {
  refreshKnowledge(): {
    entity_pages: number
    experience_notes: number
    compiled_plans: number
    workflow_candidates: number
  } {
    const entityPages = this.compileEntityPages()
    const experienceNotes = this.compileExperienceNotes()
    const compiledPlans = this.compileExperiencePlans() + this.compileLibraryPlans()
    const workflowCandidates = this.compileWorkflowCandidates()

    return {
      entity_pages: entityPages,
      experience_notes: experienceNotes,
      compiled_plans: compiledPlans,
      workflow_candidates: workflowCandidates,
    }
  }

  private compileEntityPages(): number {
    const db = getDb()
    const entities = db.prepare(
      'SELECT * FROM memory_entities ORDER BY updated_at DESC',
    ).all() as Array<Record<string, unknown>>

    for (const entity of entities) {
      const entityId = String(entity.id)
      const attributes = db.prepare(
        'SELECT key, value FROM memory_attributes WHERE entity_id = ? AND valid_to IS NULL ORDER BY key ASC',
      ).all(entityId) as Array<{ key: string; value: string }>
      const triples = db.prepare(
        `SELECT t.predicate, s.name AS subject_name, o.name AS object_name
         FROM memory_triples t
         JOIN memory_entities s ON s.id = t.subject
         JOIN memory_entities o ON o.id = t.object
         WHERE (t.subject = ? OR t.object = ?) AND t.valid_to IS NULL
         ORDER BY t.confidence DESC
         LIMIT 8`,
      ).all(entityId, entityId) as Array<{ predicate: string; subject_name: string; object_name: string }>

      const properties = safeParse<Record<string, unknown>>(String(entity.properties_json ?? '{}'), {})
      const title = `${String(entity.name)} (${String(entity.type)})`
      const bodyLines = [
        `Entity: ${String(entity.name)}`,
        `Type: ${String(entity.type)}`,
        `Wing: ${String(entity.wing ?? '') || 'n/a'}`,
        `Room: ${String(entity.room ?? '') || 'n/a'}`,
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

      memoryKernel.upsertCompiledKnowledge({
        kind: 'wiki_page',
        title,
        body: bodyLines.join('\n').trim(),
        wing: String(entity.wing ?? ''),
        room: String(entity.room ?? ''),
        source_type: 'memory_entity',
        source_ref: entityId,
        tags: [String(entity.type), String(entity.wing ?? '')].filter(Boolean),
        metadata: {
          entity_id: entityId,
          type: String(entity.type),
        },
        rank_score: 0.72,
      })
    }

    return entities.length
  }

  private compileExperienceNotes(): number {
    const db = getDb()
    const experiences = db.prepare(
      'SELECT * FROM experiences ORDER BY importance DESC, created_at DESC',
    ).all() as ExperienceRow[]

    for (const experience of experiences) {
      const content = this.readExperienceBody(experience.file_path)
      memoryKernel.upsertCompiledKnowledge({
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
    const db = getDb()
    const experiences = db.prepare(
      'SELECT * FROM experiences WHERE importance >= 0.7 ORDER BY importance DESC, created_at DESC',
    ).all() as ExperienceRow[]

    for (const experience of experiences) {
      const content = this.readExperienceBody(experience.file_path)
      const planLines = this.extractPlanLines(content)
      if (planLines.length === 0) continue

      memoryKernel.upsertCompiledKnowledge({
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
    const db = getDb()
    const workflows = db.prepare(
      'SELECT * FROM workflows ORDER BY published DESC, updated_at DESC',
    ).all() as Array<Record<string, unknown>>

    for (const workflow of workflows) {
      const graph = safeParse<{ nodes?: Array<{ type?: string; label?: string }> }>(
        String(workflow.graph_json ?? '{}'),
        {},
      )
      const nodeSummary = (graph.nodes ?? []).map((node) => `${node.label ?? node.type ?? 'node'}`).join(' -> ')

      memoryKernel.upsertCompiledKnowledge({
        kind: 'workflow_candidate',
        title: `Workflow: ${String(workflow.name)}`,
        body: [
          `Description: ${String(workflow.description ?? '') || 'n/a'}`,
          `Trigger: ${String(workflow.trigger_type ?? 'manual')}`,
          nodeSummary ? `Nodes: ${nodeSummary}` : '',
        ].filter(Boolean).join('\n'),
        source_type: 'workflow',
        source_ref: String(workflow.id),
        tags: ['workflow', String(workflow.trigger_type ?? 'manual')],
        metadata: {
          workflow_id: Number(workflow.id),
          published: Number(workflow.published ?? 0) === 1,
        },
        rank_score: Number(workflow.published ?? 0) === 1 ? 0.8 : 0.6,
      })
    }

    return workflows.length
  }

  private compileLibraryPlans(): number {
    const plans = planLibrary.listPlans()
    for (const plan of plans) {
      const bodyLines = [
        `Intent: ${plan.intent || 'n/a'}`,
        `Input: ${plan.input || 'n/a'}`,
        '',
        'Steps:',
        ...plan.steps.map((step, index) => `${index + 1}. ${step.tool}.${step.action} ${JSON.stringify(step.params)}`),
      ]

      memoryKernel.upsertCompiledKnowledge({
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
    try {
      const raw = fs.readFileSync(filePath, 'utf-8')
      const bodyStart = raw.indexOf('---', raw.indexOf('---') + 3)
      return bodyStart === -1 ? raw.trim() : raw.slice(bodyStart + 3).trim()
    } catch {
      return ''
    }
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
