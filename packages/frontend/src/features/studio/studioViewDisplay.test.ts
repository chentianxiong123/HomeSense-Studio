import { describe, expect, it } from 'vitest'
import {
  formatBindingKind,
  formatCapability,
  formatExecutionMode,
  formatShowcaseBadge,
  formatShowcaseEyebrow,
  formatVariableSource,
} from './studioViewDisplay'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('studioViewDisplay', () => {
  it('formats showcase labels and variable sources into localized display text', () => {
    expect(formatShowcaseBadge('Hero', label)).toBe('主线|Hero')
    expect(formatShowcaseEyebrow('Family Entertainment', label)).toBe('家庭娱乐|Family Entertainment')
    expect(formatVariableSource('workflow input', label)).toBe('工作流输入|Workflow Input')
    expect(formatVariableSource('executor_call', label)).toBe('执行器调用|Executor Call')
  })

  it('formats execution modes, capability names, and binding kinds', () => {
    expect(formatExecutionMode('deferred', label)).toBe('排队执行|Deferred')
    expect(formatExecutionMode('immediate', label)).toBe('立即执行|Immediate')
    expect(formatCapability('dry_run', label)).toBe('演练|Dry Run')
    expect(formatCapability('launch_app', label)).toBe('启动应用|Launch App')
    expect(formatBindingKind('a2a', label)).toBe('A2A')
    expect(formatBindingKind('none', label)).toBe('未绑定|None')
  })
})
