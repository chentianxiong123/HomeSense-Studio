import test from 'node:test'
import assert from 'node:assert/strict'
import type { ContextCompletionResult } from '../context-completer/index.js'
import { shouldUseDirectActionRouting } from './index.js'

test('workflow-oriented query does not use direct action routing even if bilibili is recognized', () => {
  const completion: ContextCompletionResult = {
    original_message: 'run the bilibili workflow',
    completed_message: 'run the bilibili workflow',
    matched_media_app: 'bilibili',
    device_weights: [],
  }

  const result = shouldUseDirectActionRouting('run the bilibili workflow', completion.completed_message, completion)
  assert.equal(result, false)
})

test('watch bilibili on tv still uses direct action routing', () => {
  const completion: ContextCompletionResult = {
    original_message: 'watch bilibili on tv',
    completed_message: '在东芝电视上看B站',
    matched_media_app: 'bilibili',
    target_device_type: 'tv',
    device_weights: [],
  }

  const result = shouldUseDirectActionRouting('watch bilibili on tv', completion.completed_message, completion)
  assert.equal(result, true)
})

