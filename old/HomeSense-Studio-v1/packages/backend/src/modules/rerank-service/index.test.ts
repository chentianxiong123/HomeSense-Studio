import test from 'node:test'
import assert from 'node:assert/strict'
import { rerankService } from './index.js'

test('rerankService prefers the candidate that matches the user goal more closely', async () => {
  const ranked = await rerankService.rankDocuments({
    query: 'watch bilibili on tv',
    documents: [
      {
        id: 'tv-bilibili',
        text: 'Watch bilibili on the Toshiba TV using the compiled entertainment plan.',
        base_score: 0.6,
      },
      {
        id: 'desktop-wake',
        text: 'Wake the desktop computer through the bluetooth wake card.',
        base_score: 0.9,
      },
    ],
  })

  assert.equal(ranked[0]?.id, 'tv-bilibili')
  assert.ok((ranked[0]?.score ?? 0) > (ranked[1]?.score ?? 0))
})

