import { describe, expect, it } from 'vitest'
import {
  formatAgentAdapterCategory,
  formatAgentAdapterMode,
  formatAgentAdapterStatus,
  formatAgentAdapterTransport,
  formatCliExecutorProtocol,
  formatCliExecutorSource,
  formatExecutorKind,
} from './studioExecutorDisplay'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('studioExecutorDisplay', () => {
  it('formats executor and adapter enums into localized labels', () => {
    expect(formatExecutorKind('agent', label)).toBe('能力适配|Capability')
    expect(formatCliExecutorSource('builtin', label)).toBe('内建|Built-in')
    expect(formatCliExecutorProtocol('process_json_arg', label)).toBe('JSON 参数|JSON Arg')
    expect(formatAgentAdapterCategory('automation', label)).toBe('自动化|Automation')
    expect(formatAgentAdapterTransport('remote_bridge', label)).toBe('远程桥接|Remote Bridge')
    expect(formatAgentAdapterStatus('planned', label)).toBe('规划中|Planned')
    expect(formatAgentAdapterMode('a2a_dry_run', label)).toBe('远程演练|Remote Dry Run')
  })
})
