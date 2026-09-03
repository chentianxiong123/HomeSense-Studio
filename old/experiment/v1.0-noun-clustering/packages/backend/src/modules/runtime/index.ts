/**
 * Module: runtime
 *
 * The runtime noun: conversation context window + runtime capability map.
 * Was the consolidation of two legacy modules:
 *   - runtime-context       (active context window, TTL, retrieval hits)
 *   - runtime-capability-map (aggregated view of all surfaces: device, executor,
 *     provider, workflow_node, skill, mcp)
 *
 * Public surface (re-exported here):
 *   - runtime-context: RuntimeContextService, buildRuntimeContextWindow, types
 *   - capability-map:  RuntimeCapabilityMapService, runtimeCapabilityMapService, types
 */

export * from './runtime-context.js'
export * from './capability-map.js'
