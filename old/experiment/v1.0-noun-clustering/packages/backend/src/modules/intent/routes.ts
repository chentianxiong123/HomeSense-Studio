import type { FastifyInstance } from 'fastify'
import { intentRouter } from './router.js'
import { shouldUseDirectActionRouting } from './router.js'

export async function intentRouterRoutes(app: FastifyInstance) {
  app.post('/api/intent/preview', async (request) => {
    const body = (request.body as {
      message?: string
      history?: Array<{ role: string; content: string }>
      working_context?: Record<string, unknown>
    } | undefined) ?? {}

    const message = String(body.message ?? '').trim()
    if (!message) {
      return { status: 'error', error: 'INVALID_PARAMS', message: 'Missing message parameter' }
    }

    const result = await intentRouter.route({
      message,
      history: body.history ?? [],
      working_context: body.working_context ?? {},
    })

    return {
      status: 'success',
      data: {
        original_message: result.original_message,
        routing_message: result.routing_message,
        normalized_intent: result.normalized_intent,
        route_level: result.route_level,
        confidence: result.confidence,
        reason: result.reason,
        allow_tool_calls: result.allow_tool_calls,
        completion: result.completion,
        matched_plan_id: result.matched_plan?.id ?? null,
        matched_rule_id: result.matched_rule?.rule_id ?? null,
        matched_skill: result.matched_skill ?? null,
        candidate_plans: result.candidate_plans,
        observations: result.observations,
        search_hits: result.search_hits,
        evidence: result.evidence,
      },
    }
  })
}

export { shouldUseDirectActionRouting }
