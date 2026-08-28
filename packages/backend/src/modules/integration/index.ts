/**
 * Module: integration
 *
 * The integration noun: anything that bridges the system to the outside world.
 * Was the consolidation of four legacy modules:
 *   - external-integrations (user-managed integrations like bilibili/mi/cloud)
 *   - cli-bridge            (subprocess bridge to local CLI executors)
 *   - command               (L1 reflex routes for the chat command path)
 *
 * Public surface (re-exported here):
 *   - external-integrations: externalIntegrationsService, ExternalIntegrationRecord, routes
 *   - cli-bridge: cliBridge, CLIBridge, CLIResult, CLIBridgePort
 *   - command: commandRoutes, L1_REFLEX_POLICY, shouldAttemptL1Reflex, CONTEXT_TTL_MS
 */

export * from './external-integrations.js'
export * from './cli-bridge.js'
export * as command from './command.routes.js'
export { CONTEXT_TTL_MS } from './command.constants.js'
export { L1_REFLEX_POLICY, shouldAttemptL1Reflex } from './command.l1-reflex-policy.js'
