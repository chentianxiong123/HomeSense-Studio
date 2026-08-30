/**
 * Port: Intent
 *
 * Lightweight intent classification that runs before the LLM.
 * Decides: is this a command, a question, a chat, or a workflow trigger?
 * Used by the L1/L2/L3 router and the front-end to render a sensible
 * "what is the system doing right now" panel.
 */

export type IntentKind = 'command' | 'question' | 'chat' | 'workflow' | 'unknown'

export interface IntentSignals {
  /** Lower-case, stripped input. */
  text: string
  /** Optional device / room context. */
  context_device_id?: string
  context_room?: string
  /** Whether the user has any active skill bindings. */
  active_skill_ids?: string[]
  /** Time of day in user's locale, used for time-bound intents. */
  local_time?: string
}

export interface IntentResult {
  kind: IntentKind
  confidence: number
  /** Optional sub-classification the router can branch on. */
  sub_kind?: string
  /** Suggested next stage: 'L1' (rule), 'L2' (memory), 'L3' (LLM). */
  suggested_stage: 'L1' | 'L2' | 'L3'
  reason: string
}

export interface IntentPort {
  classify(signals: IntentSignals): Promise<IntentResult>
  /** A short human label for the front-end trace panel. */
  explain(intent: IntentResult): string
}
