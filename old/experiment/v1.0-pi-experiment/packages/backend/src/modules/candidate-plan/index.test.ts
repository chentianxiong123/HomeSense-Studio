import { expect, test } from 'vitest'
import {
  CandidatePlanService,
  applyCandidateKindStrategy,
  applyObservationAdjustment,
  mergeDuplicateCandidates,
  mergeProviderRerankScores,
  type CandidatePlan,
  type ObservationForAdjustment,
} from './index.js'

const assert = {
  equal(actual: unknown, expected: unknown) {
    expect(actual).toEqual(expected)
  },
  ok(value: unknown) {
    expect(value).toBeTruthy()
  },
}

test('collectCandidates turns memory experience path hits into L2 candidates', async () => {
  const service = new CandidatePlanService(
    {
      search: () => [],
      semanticSearch: async () => [],
      getCompiledKnowledgeItem: () => undefined,
    } as any,
    {
      searchExperiencePaths: () => [
        {
          id: 'memory:memory.experience_path.runtime.test.bilibili',
          content: '客厅电视打开 B 站\n在客厅电视上打开 Bilibili',
          type: 'experience_path',
          wing: 'memory',
          room: '',
          score: 0.88,
          fts_score: 0.88,
          graph_score: 0,
          source: 'memory',
          metadata: {
            title: '客厅电视打开 B 站',
            summary: '在客厅电视上打开 Bilibili',
            intent_pattern: '我要看 B 站',
            success_count: 2,
            steps: [
              {
                tool: 'device_agent',
                action: 'execute_device_capability',
                params: { device_id: 2, capability_id: 'adb.launch_app' },
              },
            ],
          },
        },
      ],
    } as any,
  )

  const candidates = await service.collectCandidates({ query: '看 B 站' })

  assert.equal(candidates.length, 1)
  assert.equal(candidates[0]?.id, 'memory:memory.experience_path.runtime.test.bilibili')
  assert.equal(candidates[0]?.source, 'memory')
  assert.equal(candidates[0]?.candidate_kind, 'compiled_plan')
  assert.equal(candidates[0]?.steps[0]?.tool, 'device_agent')
  assert.equal(candidates[0]?.success_count, 2)
  assert.equal(candidates[0]?.failure_count, 0)
})

test('collectCandidates carries workflow memory stats and penalizes failed paths', async () => {
  const service = new CandidatePlanService(
    {
      search: () => [],
      semanticSearch: async () => [],
      getCompiledKnowledgeItem: () => undefined,
    } as any,
    {
      searchExperiencePaths: () => [
        {
          id: 'memory:memory.experience_path.workflow.7',
          content: '客厅电视 Workflow\n打开 B 站',
          type: 'experience_path',
          wing: 'memory',
          room: '',
          score: 0.82,
          fts_score: 0.82,
          graph_score: 0,
          source: 'memory',
          metadata: {
            title: '客厅电视 Workflow',
            summary: '打开 B 站成功路径',
            intent_pattern: '我要看 B 站',
            workflow_id: 7,
            workflow_graph_hash: 'workflow_graph_v1',
            workflow_inputs: { device_id: 2, app: 'bilibili' },
            saved_from: 'workflow_success',
            success_count: 4,
            failure_count: 0,
            steps: [
              { tool: 'device_agent', action: 'execute_device_capability', params: { device_id: 2, capability_id: 'adb.launch_app' } },
            ],
          },
        },
        {
          id: 'memory:memory.experience_path.workflow.8',
          content: '客厅电视 Workflow 失败\n打开 B 站',
          type: 'experience_path',
          wing: 'memory',
          room: '',
          score: 0.82,
          fts_score: 0.82,
          graph_score: 0,
          source: 'memory',
          metadata: {
            title: '客厅电视 Workflow 失败',
            summary: '打开 B 站失败路径',
            intent_pattern: '我要看 B 站',
            workflow_id: 8,
            saved_from: 'workflow_failure',
            success_count: 0,
            failure_count: 4,
            steps: [
              { tool: 'device_agent', action: 'execute_device_capability', params: { device_id: 2, capability_id: 'adb.launch_app' } },
            ],
          },
        },
      ],
    } as any,
  )

  const candidates = await service.collectCandidates({ query: '看 B 站' })
  const successful = candidates.find((candidate) => candidate.workflow_id === 7)
  const failed = candidates.find((candidate) => candidate.workflow_id === 8)

  assert.equal(successful?.candidate_kind, 'workflow_candidate')
  assert.equal(successful?.workflow_graph_hash, 'workflow_graph_v1')
  assert.equal(successful?.workflow_inputs?.device_id, 2)
  assert.equal(successful?.workflow_inputs?.app, 'bilibili')
  assert.equal(successful?.success_count, 4)
  assert.equal(successful?.failure_count, 0)
  assert.equal(successful?.evidence_status, 'proven')
  assert.ok((successful?.reuse_score ?? 0) > 0.8)
  assert.equal(failed?.candidate_kind, 'workflow_candidate')
  assert.equal(failed?.success_count, 0)
  assert.equal(failed?.failure_count, 4)
  assert.equal(failed?.evidence_status, 'failing')
  assert.ok((successful?.confidence ?? 0) > (failed?.confidence ?? 0))
})

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

test('applyCandidateKindStrategy lets proven workflow candidates win for direct actions', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'workflow_1',
      title: 'Proven Bilibili Workflow',
      source: 'memory',
      candidate_kind: 'workflow_candidate',
      confidence: 0.84,
      goal: 'Run a proven workflow that opens bilibili',
      entities: ['toshiba_tv', 'bilibili'],
      steps: [],
      assumptions: [],
      risks: [],
      evidence: [],
      workflow_id: 7,
      evidence_status: 'proven',
      reuse_score: 0.88,
      success_count: 5,
      failure_count: 0,
    },
    {
      id: 'plan:path_demo_watch_bilibili',
      title: 'watch_bilibili_demo',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.82,
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

  assert.equal(ranked[0]?.candidate_kind, 'workflow_candidate')
  assert.equal(ranked[0]?.workflow_id, 7)
})

test('applyCandidateKindStrategy penalizes failing workflow candidates for direct actions', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'workflow_1',
      title: 'Failing Bilibili Workflow',
      source: 'memory',
      candidate_kind: 'workflow_candidate',
      confidence: 0.86,
      goal: 'Run a failing workflow that opens bilibili',
      entities: ['toshiba_tv', 'bilibili'],
      steps: [],
      assumptions: [],
      risks: [],
      evidence: [],
      workflow_id: 7,
      evidence_status: 'failing',
      reuse_score: 0.12,
      success_count: 0,
      failure_count: 4,
    },
    {
      id: 'plan:path_demo_watch_bilibili',
      title: 'watch_bilibili_demo',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.82,
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

test('applyObservationAdjustment boosts confidence for successful past actions', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'plan:lamp_on',
      title: 'Turn on lamp',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.8,
      goal: 'Turn on the bedroom lamp',
      entities: ['lamp'],
      steps: [{ tool: 'mi-cli', action: 'set_prop', params: {} }],
      assumptions: [],
      risks: [],
      evidence: [],
    },
  ]
  const observations: ObservationForAdjustment[] = [
    { success_count: 3, failure_count: 0, last_action: 'mi-cli.set_prop' },
  ]

  const adjusted = applyObservationAdjustment(candidates, observations)

  assert.equal(adjusted.length, 1)
  assert.ok(adjusted[0].confidence > 0.8)
  // 3/3 success = success_rate 1.0 → delta = 0.05 * (1.0 - 0.5) * 2 = 0.05
  assert.ok(Math.abs(adjusted[0].confidence - 0.85) < 0.001)
})

test('applyObservationAdjustment penalizes confidence for failed past actions', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'plan:list_packages',
      title: 'List packages',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.8,
      goal: 'List installed packages on TV',
      entities: ['tv'],
      steps: [{ tool: 'adb-cli', action: 'list_packages', params: {} }],
      assumptions: [],
      risks: [],
      evidence: [],
    },
  ]
  const observations: ObservationForAdjustment[] = [
    { success_count: 0, failure_count: 3, last_action: 'adb-cli.list_packages' },
  ]

  const adjusted = applyObservationAdjustment(candidates, observations)

  assert.equal(adjusted.length, 1)
  // 0/3 success = success_rate 0 → delta = 0.05 * (0 - 0.5) * 2 = -0.05
  assert.equal(adjusted[0].confidence, 0.75)
})

test('applyObservationAdjustment noise guard: fewer than 2 total runs does nothing', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'plan:test',
      title: 'Test action',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.7,
      goal: 'Test',
      entities: [],
      steps: [{ tool: 'mi-cli', action: 'set_prop', params: {} }],
      assumptions: [],
      risks: [],
      evidence: [],
    },
  ]
  const observations: ObservationForAdjustment[] = [
    { success_count: 1, failure_count: 0, last_action: 'mi-cli.set_prop' },
  ]

  const adjusted = applyObservationAdjustment(candidates, observations)

  assert.equal(adjusted[0].confidence, 0.7)
})

test('applyObservationAdjustment accumulation: multiple steps with offsetting deltas', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'plan:watch_bilibili',
      title: 'Watch bilibili',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.8,
      goal: 'Watch bilibili on TV',
      entities: ['bilibili'],
      steps: [
        { tool: 'mi-cli', action: 'scene_execute', params: {} },
        { tool: 'adb-cli', action: 'launch_app', params: {} },
      ],
      assumptions: [],
      risks: [],
      evidence: [],
    },
  ]
  // mi-cli.scene_execute: 3/3 success → +0.05
  // adb-cli.launch_app: 0/3 success → -0.05
  // total delta = 0 → confidence unchanged
  const observations: ObservationForAdjustment[] = [
    { success_count: 3, failure_count: 0, last_action: 'mi-cli.scene_execute' },
    { success_count: 0, failure_count: 3, last_action: 'adb-cli.launch_app' },
  ]

  const adjusted = applyObservationAdjustment(candidates, observations)

  assert.equal(adjusted[0].confidence, 0.8)
})

test('applyObservationAdjustment clamps confidence within [0, 0.99]', () => {
  const candidates: CandidatePlan[] = [
    {
      id: 'plan:maxed',
      title: 'Max confidence',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.98,
      goal: 'Test clamping upper bound',
      entities: [],
      steps: [{ tool: 'tool', action: 'always_works', params: {} }],
      assumptions: [],
      risks: [],
      evidence: [],
    },
    {
      id: 'plan:minned',
      title: 'Min confidence',
      source: 'plan_library',
      candidate_kind: 'compiled_plan',
      confidence: 0.02,
      goal: 'Test clamping lower bound',
      entities: [],
      steps: [{ tool: 'tool', action: 'always_fails', params: {} }],
      assumptions: [],
      risks: [],
      evidence: [],
    },
  ]
  const observations: ObservationForAdjustment[] = [
    { success_count: 10, failure_count: 0, last_action: 'tool.always_works' },
    { success_count: 0, failure_count: 10, last_action: 'tool.always_fails' },
  ]

  const adjusted = applyObservationAdjustment(candidates, observations)

  assert.equal(adjusted.length, 2)
  assert.equal(adjusted.find((p) => p.id === 'plan:maxed')!.confidence, 0.99)
  assert.equal(adjusted.find((p) => p.id === 'plan:minned')!.confidence, 0)
})
