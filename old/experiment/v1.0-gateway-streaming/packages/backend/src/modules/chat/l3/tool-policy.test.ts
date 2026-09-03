import { describe, expect, it } from 'vitest'
import {
  classifyL3ToolPolicy,
  isToolAllowedByPolicy,
} from './tool-policy.js'

describe('L3 tool policy', () => {
  it('keeps explicit no-execution device text read-only', () => {
    const policy = classifyL3ToolPolicy('帮我看看有哪些设备在线，不要操作设备')

    expect(policy.kind).toBe('read_only')
    expect(isToolAllowedByPolicy('list_user_devices', policy.kind)).toBe(true)
    expect(isToolAllowedByPolicy('rehearse_device_capability', policy.kind)).toBe(false)
    expect(isToolAllowedByPolicy('execute_device_capability', policy.kind)).toBe(false)
  })

  it('keeps multi-step and workflow requests in preview mode', () => {
    expect(classifyL3ToolPolicy('打开电视，然后播放B站').kind).toBe('preview_only')
    expect(classifyL3ToolPolicy('执行看电视流程').kind).toBe('preview_only')
    expect(isToolAllowedByPolicy('preview_workflow', 'preview_only')).toBe(true)
    expect(isToolAllowedByPolicy('run_workflow', 'preview_only')).toBe(false)
    expect(isToolAllowedByPolicy('execute_device_capability', 'preview_only')).toBe(false)
  })

  it('allows execution only for short imperative commands or system actions', () => {
    expect(classifyL3ToolPolicy('打开电视').kind).toBe('execute_allowed')
    expect(classifyL3ToolPolicy('记住我喜欢客厅音箱').kind).toBe('execute_allowed')
    expect(isToolAllowedByPolicy('execute_device_capability', 'execute_allowed')).toBe(true)
    expect(isToolAllowedByPolicy('run_workflow', 'execute_allowed')).toBe(true)
  })

  it('does not expose tools for pure chat', () => {
    const policy = classifyL3ToolPolicy('你好')

    expect(policy.kind).toBe('none')
    expect(isToolAllowedByPolicy('list_user_devices', policy.kind)).toBe(false)
  })

  it('does not execute targetless short verbs without active context', () => {
    expect(classifyL3ToolPolicy('打开').kind).toBe('none')
  })
})
