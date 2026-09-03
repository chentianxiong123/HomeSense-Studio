import { describe, expect, it, vi } from 'vitest'
import { IntentRouterService } from './router.js'

describe('IntentRouterService routing boundary', () => {
  it('does not run L2 candidate retrieval for non-action chat', async () => {
    const candidatePlanService = { resolve: vi.fn(async () => []) }
    const memoryKernel = {
      recallObservations: vi.fn(() => []),
      search: vi.fn(() => []),
    }
    const memoryAssets = {
      searchExperiencePaths: vi.fn(() => []),
    }
    const router = new IntentRouterService(
      candidatePlanService as any,
      {
        complete: () => ({
          original_message: '你好',
          completed_message: '你好',
          device_weights: [],
        }),
      } as any,
      memoryKernel as any,
      {
        resolveByContext: vi.fn(() => undefined),
        matchPlan: vi.fn(() => undefined),
      } as any,
      {
        match: vi.fn(() => null),
      } as any,
      {
        listSkills: vi.fn(() => []),
      } as any,
      memoryAssets as any,
    )

    const result = await router.route({ message: '你好' })

    expect(result.route_level).toBe(3)
    expect(result.allow_tool_calls).toBe(false)
    expect(result.candidate_plans).toEqual([])
    expect(result.search_hits).toEqual([])
    expect(candidatePlanService.resolve).not.toHaveBeenCalled()
    expect(memoryKernel.recallObservations).not.toHaveBeenCalled()
    expect(memoryKernel.search).not.toHaveBeenCalled()
    expect(memoryAssets.searchExperiencePaths).not.toHaveBeenCalled()
  })

  it('allows L2 retrieval for direct device action intent', async () => {
    const candidatePlanService = { resolve: vi.fn(async () => []) }
    const memoryKernel = {
      recallObservations: vi.fn(() => []),
      search: vi.fn(() => []),
    }
    const memoryAssets = {
      searchExperiencePaths: vi.fn(() => []),
    }
    const router = new IntentRouterService(
      candidatePlanService as any,
      {
        complete: () => ({
          original_message: '打开电视',
          completed_message: '打开电视',
          target_device_id: 'tv-1',
          target_device_label: '电视',
          target_device_type: 'tv',
          device_weights: [{ device_id: 'tv-1', label: '电视', type: 'tv', score: 1 }],
        }),
      } as any,
      memoryKernel as any,
      {
        resolveByContext: vi.fn(() => undefined),
        matchPlan: vi.fn(() => undefined),
      } as any,
      {
        match: vi.fn(() => null),
      } as any,
      {
        listSkills: vi.fn(() => []),
      } as any,
      memoryAssets as any,
    )

    const result = await router.route({ message: '打开电视' })

    expect(result.allow_tool_calls).toBe(true)
    expect(candidatePlanService.resolve).toHaveBeenCalledTimes(1)
    expect(memoryKernel.recallObservations).toHaveBeenCalledTimes(1)
    expect(memoryKernel.search).toHaveBeenCalledTimes(1)
    expect(memoryAssets.searchExperiencePaths).toHaveBeenCalledTimes(1)
  })

  it('marks experience path evidence as memory instead of generic search', async () => {
    const candidatePlanService = { resolve: vi.fn(async () => []) }
    const memoryKernel = {
      recallObservations: vi.fn(() => []),
      search: vi.fn(() => []),
    }
    const memoryAssets = {
      searchExperiencePaths: vi.fn(() => [
        {
          id: 'memory:memory.experience_path.runtime.watch-tv',
          content: '客厅电视打开 B 站',
          type: 'experience_path',
          wing: 'memory',
          room: '',
          score: 0.88,
          fts_score: 0.88,
          graph_score: 0,
          source: 'memory',
          metadata: {},
        },
      ]),
    }
    const router = new IntentRouterService(
      candidatePlanService as any,
      {
        complete: () => ({
          original_message: '打开电视',
          completed_message: '打开电视',
          target_device_id: 'tv-1',
          target_device_label: '电视',
          target_device_type: 'tv',
          device_weights: [{ device_id: 'tv-1', label: '电视', type: 'tv', score: 1 }],
        }),
      } as any,
      memoryKernel as any,
      {
        resolveByContext: vi.fn(() => undefined),
        matchPlan: vi.fn(() => undefined),
      } as any,
      {
        match: vi.fn(() => null),
      } as any,
      {
        listSkills: vi.fn(() => []),
      } as any,
      memoryAssets as any,
    )

    const result = await router.route({ message: '打开电视' })

    expect(result.route_level).toBe(2)
    expect(result.evidence).toContainEqual(expect.objectContaining({
      source: 'memory',
      ref: 'memory:memory.experience_path.runtime.watch-tv',
      note: 'experience_path',
    }))
    expect(result.evidence).not.toContainEqual(expect.objectContaining({
      source: 'search',
      ref: 'memory:memory.experience_path.runtime.watch-tv',
    }))
  })
})
