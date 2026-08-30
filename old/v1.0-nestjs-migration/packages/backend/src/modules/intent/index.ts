/**
 * Module: intent
 *
 * The intent noun: context completion, fingerprinting, and L1/L2/L3 routing.
 * Was the consolidation of three legacy modules:
 *   - context-completer (fills in target device / pronouns / media hints)
 *   - intent-fingerprint (stable hash for an intent from steps or completion)
 *   - intent-router (L1/L2/L3 routing orchestrator)
 *
 * Public surface (re-exported here):
 *   - context-completer: ContextCompleterService, contextCompleter, types
 *   - fingerprint: buildFingerprintFromSteps, buildFingerprintFromCompletion, fingerprintMatchScore
 *   - router: IntentRouterService, intentRouter, shouldUseDirectActionRouting, types
 */

export * from './context-completer.js'
export * from './fingerprint.js'
export * from './router.js'
