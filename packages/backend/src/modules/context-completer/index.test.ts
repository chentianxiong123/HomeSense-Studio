import test from 'node:test'
import assert from 'node:assert/strict'
import { contextCompleter } from './index.js'

test('does not rewrite workflow-oriented bilibili queries into TV watch commands', () => {
  const result = contextCompleter.complete({
    message: 'run the bilibili workflow',
    history: [],
    working_context: { preferred_tv_device_id: 'toshiba_tv' },
  })

  assert.equal(result.completed_message, 'run the bilibili workflow')
})

test('rewrites action-oriented bilibili queries into a concrete TV watch command', () => {
  const result = contextCompleter.complete({
    message: 'watch bilibili on tv',
    history: [],
    working_context: { preferred_tv_device_id: 'toshiba_tv' },
  })

  assert.match(result.completed_message, /bilibili|B站/i)
  assert.equal(result.target_device_id, 'toshiba_tv')
})

