import type { FastifyInstance } from 'fastify'
import { knowledgeCompiler } from '../knowledge-compiler/index.js'
import { memoryKernel } from './index.js'

export async function memoryRoutes(app: FastifyInstance) {
  app.get('/api/memory/status', async () => {
    return { status: 'success', data: memoryKernel.getStatus() }
  })

  app.get('/api/memory/profiles', async () => {
    return { status: 'success', data: memoryKernel.listEmbeddingProfiles() }
  })

  app.post('/api/memory/profiles/sync-canonical', async () => {
    return { status: 'success', data: memoryKernel.ensureCanonicalEmbeddingProfile() }
  })

  app.post('/api/memory/remember', async (request) => {
    const body = request.body as {
      content: string
      type: 'person' | 'device' | 'room' | 'concept' | 'skill'
      wing: string
      room?: string
      confidence?: number
      source?: string
      source_file?: string
    }
    if (!body.content || !body.type || !body.wing) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Missing content/type/wing parameter' }
    }

    memoryKernel.remember(body.content, {
      type: body.type,
      wing: body.wing,
      room: body.room ?? '',
      confidence: body.confidence,
      source: body.source,
      source_file: body.source_file,
    })
    return { status: 'success' }
  })

  app.get('/api/memory/recall', async (request) => {
    const query = request.query as { wing: string; room?: string }
    if (!query.wing) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Missing wing parameter' }
    }
    return { status: 'success', data: memoryKernel.recall(query.wing, query.room) }
  })

  app.get('/api/memory/search', async (request) => {
    const query = request.query as { q: string }
    if (!query.q) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Missing q parameter' }
    }
    return { status: 'success', data: memoryKernel.search(query.q) }
  })

  app.get('/api/memory/semantic-search', async (request) => {
    const query = request.query as { q: string; limit?: string }
    if (!query.q) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Missing q parameter' }
    }
    return {
      status: 'success',
      data: await memoryKernel.semanticSearch(query.q, query.limit ? Number(query.limit) : 10),
    }
  })

  app.get('/api/memory/wakeup', async () => {
    return { status: 'success', data: memoryKernel.wakeUp() }
  })

  app.get('/api/memory/graph', async (request) => {
    const query = request.query as { wing?: string }
    return { status: 'success', data: memoryKernel.buildGraph(query.wing) }
  })

  app.get('/api/memory/compiled', async (request) => {
    const query = request.query as {
      kind?: 'wiki_page' | 'compiled_plan' | 'experience_note' | 'skill_candidate' | 'rule_candidate' | 'workflow_candidate'
      wing?: string
      room?: string
      limit?: string
    }
    return {
      status: 'success',
      data: memoryKernel.listCompiledKnowledge({
        kind: query.kind,
        wing: query.wing,
        room: query.room,
        limit: query.limit ? Number(query.limit) : undefined,
      }),
    }
  })

  app.post('/api/memory/compile', async () => {
    return { status: 'success', data: knowledgeCompiler.refreshKnowledge() }
  })

  app.post('/api/memory/embeddings/rebuild', async (request) => {
    const body = (request.body as { limit?: number } | undefined) ?? {}
    return {
      status: 'success',
      data: await memoryKernel.rebuildCompiledKnowledgeEmbeddings(body.limit),
    }
  })
}
