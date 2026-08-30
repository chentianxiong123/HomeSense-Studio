import { getDatabase, recordRuleHit } from './database.js'
import { expandSynonyms } from './expander.js'

interface MatchResult {
  matched: boolean
  response: string | null
  matchedTrigger: string | null
  actions?: unknown[]
}

export function matchWithSynonyms(input: string): MatchResult {
  const db = getDatabase()
  const { candidates } = expandSynonyms(input)

  for (const candidate of candidates) {
    const row = db.prepare('SELECT response, trigger, actions FROM rules WHERE trigger = ? AND COALESCE(enabled, 1) = 1').get(candidate) as { response: string; trigger: string; actions?: string | null } | undefined

    if (row) {
      recordRuleHit(row.trigger)
      return {
        matched: true,
        response: row.response,
        matchedTrigger: row.trigger,
        actions: row.actions ? JSON.parse(row.actions) : undefined,
      }
    }
  }

  return {
    matched: false,
    response: null,
    matchedTrigger: null,
  }
}

export function matchExact(input: string): MatchResult {
  const db = getDatabase()
  const row = db.prepare('SELECT response, trigger, actions FROM rules WHERE trigger = ? AND COALESCE(enabled, 1) = 1').get(input) as { response: string; trigger: string; actions?: string | null } | undefined

  if (row) {
    recordRuleHit(row.trigger)
    return {
      matched: true,
      response: row.response,
      matchedTrigger: row.trigger,
      actions: row.actions ? JSON.parse(row.actions) : undefined,
    }
  }

  return {
    matched: false,
    response: null,
    matchedTrigger: null,
  }
}
