import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import RoutePreviewCard from './RoutePreviewCard.vue'

describe('RoutePreviewCard', () => {
  it('renders candidate plans plus route evidence, observations, and search hits', () => {
    const wrapper = mount(RoutePreviewCard, {
      props: {
        normalizedIntent: 'media.watch.bilibili.tv',
        routeLevel: 2,
        reason: 'compiled_knowledge_or_memory',
        confidence: 0.82,
        allowToolCalls: false,
        candidatePlans: [
          {
            id: 'plan:path_demo_watch_bilibili',
            title: 'watch_bilibili_demo',
            source: 'plan_library',
            candidate_kind: 'compiled_plan',
            confidence: 0.97,
            goal: 'Watch bilibili on the Toshiba TV',
            entities: ['toshiba_tv', 'bilibili'],
            assumptions: ['device_state_available'],
            risks: ['adb_unavailable'],
            evidence: [{ source: 'context', ref: 'bilibili:tv', note: 'context_resolve' }],
            plan_id: 'path_demo_watch_bilibili',
          },
        ],
        routeEvidence: [
          { source: 'context', ref: 'toshiba_tv', note: '东芝电视', score: 0.9 },
        ],
        observations: [
          { id: 'obs-1', name: 'intent:watch_bilibili', score: 0.88, last_action: 'adb.launch_app' },
        ],
        searchHits: [
          { id: 'compiled_3', type: 'compiled_plan', source: 'semantic', score: 0.91 },
        ],
      },
      global: {
        stubs: {},
      },
    })

    expect(wrapper.text()).toContain('media.watch.bilibili.tv')
    expect(wrapper.text()).toContain('watch_bilibili_demo')
    expect(wrapper.text()).toContain('context_resolve')
    expect(wrapper.text()).toContain('Observations')
    expect(wrapper.text()).toContain('intent:watch_bilibili')
    expect(wrapper.text()).toContain('Search')
    expect(wrapper.text()).toContain('compiled_plan')
    expect(wrapper.text()).toContain('Route Evidence')
    expect(wrapper.text()).toContain('东芝电视')
  })
})

