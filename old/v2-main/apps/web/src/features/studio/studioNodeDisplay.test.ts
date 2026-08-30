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
    expect(formatNodeLabel('device_capability', 'Device Capability', label)).toBe('设备能力|Device Capability')
    expect(formatNodeLabel('answer', 'Answer', label)).toBe('回答节点|Answer')
    expect(formatNodeDescription('device_capability', 'Device Capability', label)).toBe('通过统一设备能力直接执行真实设备动作。|Run a structured device capability against the real device runtime.')
    expect(formatNodeDescription('executor_call', 'Invoke executor via gateway.', label)).toBe('兼容低层执行网关；设备动作优先使用设备能力节点。|Compatibility entry for low-level executors; prefer Device Capability for smart-home actions.')
  })

  it('formats config field labels and categories', () => {
    expect(formatNodeFieldLabel('capability_id', 'Capability ID', label)).toBe('能力 ID|Capability ID')
    expect(formatNodeFieldLabel('arguments', 'Arguments', label)).toBe('能力参数|Arguments')
    expect(formatNodeFieldLabel('workflow_id', 'Workflow ID', label)).toBe('工作流 ID|Workflow ID')
    expect(formatNodeFieldLabel('output_key', 'Output Key', label)).toBe('输出键|Output Key')
    expect(formatNodeCategory('compute', label)).toBe('计算|Compute')
    expect(formatNodeCategory('output', label)).toBe('输出|Output')
  })
})
