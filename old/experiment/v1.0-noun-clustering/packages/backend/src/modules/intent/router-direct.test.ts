import { describe, it, expect } from 'vitest'

import type { ContextCompletionResult } from './context-completer.js'
import { shouldUseDirectActionRouting } from './router.js'

it('workflow-oriented query does not use direct action routing even if bilibili is recognized', () => {
  const completion: ContextCompletionResult = {
    original_message: 'run the bilibili workflow',
    completed_message: 'run the bilibili workflow',
    matched_media_app: 'bilibili',
    device_weights: [],
  }

  const result = shouldUseDirectActionRouting('run the bilibili workflow', completion.completed_message, completion)
  expect(result).toBe(false)
})

it('watch bilibili on tv still uses direct action routing', () => {
  const completion: ContextCompletionResult = {
    original_message: 'watch bilibili on tv',
    completed_message: '在东芝电视上看B站',
    matched_media_app: 'bilibili',
    target_device_type: 'tv',
    device_weights: [],
  }

  const result = shouldUseDirectActionRouting('watch bilibili on tv', completion.completed_message, completion)
  expect(result).toBe(true)
})

