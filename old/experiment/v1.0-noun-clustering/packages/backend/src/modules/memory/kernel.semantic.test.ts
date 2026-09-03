import { describe, it, expect } from 'vitest'
import { cosineSimilarity, semanticKindBoost } from './kernel.js'

describe('memory kernel semantic helpers', () => {
  it('cosineSimilarity gives higher score to closer vectors', () => {
    const near = cosineSimilarity([1, 0, 0], [0.9, 0.1, 0])
    const far = cosineSimilarity([1, 0, 0], [0, 1, 0])
    expect(near).toBeGreaterThan(far)
    expect(near).toBeGreaterThan(0.9)
    expect(far).toBe(0)
  })

  it('semanticKindBoost favors compiled plans over runtime observation wiki pages', () => {
    const compiled = semanticKindBoost('compiled_plan', 'home.entertainment')
    const runtimeObservation = semanticKindBoost('wiki_page', 'runtime_observations')
    expect(compiled).toBeGreaterThan(runtimeObservation)
  })
})
