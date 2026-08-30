import test from 'node:test'
import assert from 'node:assert/strict'
import { cosineSimilarity, semanticKindBoost } from './index.js'

test('cosineSimilarity gives higher score to closer vectors', () => {
  const near = cosineSimilarity([1, 0, 0], [0.9, 0.1, 0])
  const far = cosineSimilarity([1, 0, 0], [0, 1, 0])

  assert.ok(near > far)
  assert.ok(near > 0.9)
  assert.equal(far, 0)
})

test('semanticKindBoost favors compiled plans over runtime observation wiki pages', () => {
  const compiled = semanticKindBoost('compiled_plan', 'home.entertainment')
  const runtimeObservation = semanticKindBoost('wiki_page', 'runtime_observations')

  assert.ok(compiled > runtimeObservation)
})
