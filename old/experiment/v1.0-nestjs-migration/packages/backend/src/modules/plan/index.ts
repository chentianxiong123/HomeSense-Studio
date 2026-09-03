/**
 * Module: plan
 *
 * The plan noun: pre-compiled plan library + candidate plan resolution at
 * runtime. Was the consolidation of two legacy modules:
 *   - plan-library   (pre-compiled CompiledPlanDefinition, with matcher logic)
 *   - candidate-plan (resolves candidate plans from search hits + observations)
 *
 * Public surface (re-exported here):
 *   - library:   planLibrary, CompiledPlanDefinition, PlanStepDefinition
 *   - candidate: candidatePlanService, CandidatePlan
 */

export * from './library.js'
export * from './candidate.js'
