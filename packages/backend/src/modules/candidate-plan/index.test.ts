import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyCandidateKindStrategy,
  mergeDuplicateCandidates,
  mergeProviderRerankScores,
  type CandidatePlan,
} from './index.js'

test('mergeProviderRerankScores reorders candidates by provider rerank scores', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'desktop',
      title: 'Wake desktop',
      source: 'compiled_knowledge',
      candidate_kind: 'compiled_plan',
      confidence: 0.9,
      goal: 'Wake the desktop computer',
      entities: ['desktop'],
      steps: [],
      assumptions: [],
      risks: [],
      evidence: [],
    },
    {
      id: 'bilibili',
      title: 'Watch bilibili on TV',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.7,
      goal: 'Watch bilibili on the Toshiba TV',
      entities: ['toshiba_tv', 'bilibili'],
      steps: [],
      assumptions: [],
      risks: [],
      evidence: [],
    },
  ]

  const ranked = mergeProviderRerankScores(candidates, [
    { index: 0, relevance_score: 0.01 },
    { index: 1, relevance_score: 0.98 },
  ])

  assert.equal(ranked[0]?.id, 'bilibili')
  assert.ok((ranked[0]?.confidence ?? 0) > (ranked[1]?.confidence ?? 0))
})

test('mergeDuplicateCandidates merges plan-library and compiled candidates that point to the same plan', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'plan:path_demo_watch_bilibili',
      title: 'watch_bilibili_demo',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.96,
      goal: 'Watch bilibili on the Toshiba TV',
      entities: ['toshiba_tv', 'bilibili'],
      steps: [],
      assumptions: ['device_state_available'],
      risks: ['adb_unavailable'],
      evidence: [{ source: 'context', ref: 'bilibili:tv', score: 0.96 }],
      plan_id: 'path_demo_watch_bilibili',
    },
    {
      id: 'compiled:3',
      title: 'watch_bilibili_demo',
      source: 'compiled_knowledge',
      candidate_kind: 'compiled_plan',
      confidence: 0.88,
      goal: 'Watch bilibili on the Toshiba TV',
      entities: ['toshiba_tv', 'bilibili'],
      steps: [],
      assumptions: ['context_completed'],
      risks: ['device_state_drift'],
      evidence: [{ source: 'compiled_knowledge', ref: '3', score: 0.88 }],
      plan_id: 'path_demo_watch_bilibili',
      compiled_knowledge_id: 3,
    },
  ]

  const merged = mergeDuplicateCandidates(candidates)

  assert.equal(merged.length, 1)
  assert.equal(merged[0]?.plan_id, 'path_demo_watch_bilibili')
  assert.equal(merged[0]?.source, 'plan_library')
  assert.ok((merged[0]?.evidence.length ?? 0) >= 2)
  assert.ok((merged[0]?.assumptions ?? []).includes('context_completed'))
  assert.ok((merged[0]?.risks ?? []).includes('device_state_drift'))
})

test('applyCandidateKindStrategy prefers compiled plans for direct device actions', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'workflow_1',
      title: 'Bilibili Workflow Candidate',
      source: 'compiled_knowledge',
      candidate_kind: 'workflow_candidate',
      confidence: 0.89,
      goal: 'Run the workflow that eventually opens bilibili',
      entities: ['toshiba_tv', 'bilibili'],
      steps: [],
      assumptions: [],
      risks: [],
      evidence: [],
    },
    {
      id: 'plan:path_demo_watch_bilibili',
      title: 'watch_bilibili_demo',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.84,
      goal: 'Watch bilibili on the Toshiba TV',
      entities: ['toshiba_tv', 'bilibili'],
      steps: [],
      assumptions: [],
      risks: [],
      evidence: [],
      plan_id: 'path_demo_watch_bilibili',
    },
  ]

  const ranked = applyCandidateKindStrategy('watch bilibili on tv', candidates)

  assert.equal(ranked[0]?.candidate_kind, 'compiled_plan')
})

test('applyCandidateKindStrategy prefers workflow candidates for workflow-oriented queries', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'workflow_1',
      title: 'Bilibili Workflow Candidate',
      source: 'compiled_knowledge',
      candidate_kind: 'workflow_candidate',
      confidence: 0.82,
      goal: 'Run the workflow that eventually opens bilibili',
      entities: ['toshiba_tv', 'bilibili'],
      steps: [],
      assumptions: [],
      risks: [],
      evidence: [],
    },
    {
      id: 'plan:path_demo_watch_bilibili',
      title: 'watch_bilibili_demo',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.9,
      goal: 'Watch bilibili on the Toshiba TV',
      entities: ['toshiba_tv', 'bilibili'],
      steps: [],
      assumptions: [],
      risks: [],
      evidence: [],
      plan_id: 'path_demo_watch_bilibili',
    },
  ]

  const ranked = applyCandidateKindStrategy('run the bilibili workflow', candidates)

  assert.equal(ranked[0]?.candidate_kind, 'workflow_candidate')
})
