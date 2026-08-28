/**
 * Port: Rule
 *
 * The L1 reflex layer. Synchronous, low-latency, no LLM in the loop.
 * A rule decides whether the input maps to a known action; if it
 * matches, the action is returned with high confidence.
 */

export interface RuleContext {
  input: string
  normalized_input?: string
  mentioned_device?: string
  scope?: string
  intent_hint?: string
}

export type RuleActionKind = 'cli_call' | 'capability_call' | 'short_circuit'

export interface RuleActionResult {
  matched: boolean
  rule_id?: number
  priority?: number
  kind?: RuleActionKind
  /** Concrete instructions for the runtime. */
  payload?: Record<string, unknown>
  reason?: string
}

export interface RulePort {
  match(ctx: RuleContext): Promise<RuleActionResult | null>
  /** Used by the front end to display the active rule set. */
  list_active(): Promise<Array<{ id: number; pattern: string; priority: number; description?: string }>>
}
