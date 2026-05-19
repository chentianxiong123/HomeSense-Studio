import { describe, expect, it } from 'vitest'
import {
  formatNodeCategory,
  formatNodeDescription,
  formatNodeFieldLabel,
  formatNodeLabel,
} from './studioNodeDisplay'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('studioNodeDisplay', () => {
  it('formats node labels and descriptions into localized display text', () => {
    expect(formatNodeLabel('device_control', 'Device Control', label)).toBe('设备控制|Device Control')
    expect(formatNodeLabel('answer', 'Answer', label)).toBe('回答节点|Answer')
    expect(formatNodeDescription('executor_call', 'Invoke executor via gateway.', label)).toBe('通过执行网关调用能力。|Invoke executor via gateway.')
  })

  it('formats config field labels and categories', () => {
    expect(formatNodeFieldLabel('workflow_id', 'Workflow ID', label)).toBe('工作流 ID|Workflow ID')
    expect(formatNodeFieldLabel('output_key', 'Output Key', label)).toBe('输出键|Output Key')
    expect(formatNodeCategory('compute', label)).toBe('计算|Compute')
    expect(formatNodeCategory('output', label)).toBe('输出|Output')
  })
})
