import { describe, expect, it } from 'vitest'
import { buildStudioInspectorCopy } from './studioInspectorCopy'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('buildStudioInspectorCopy', () => {
  it('provides localized labels for the inspector and executor sections', () => {
    const copy = buildStudioInspectorCopy(label)

    expect(copy.basicInfo).toBe('节点信息|Node Info')
    expect(copy.runTrace).toBe('运行痕迹|Run Trace')
    expect(copy.variableMapping).toBe('变量映射|Variable Mapping')
    expect(copy.executorConfig).toBe('执行器配置|Executor Config')
    expect(copy.subflowConfig).toBe('子流程配置|Subflow Config')
    expect(copy.answerConfig).toBe('回答配置|Answer Config')
    expect(copy.genericConfig).toBe('节点配置|Node Config')
    expect(copy.runtimeExecutor).toBe('运行时执行器|Runtime Executor')
    expect(copy.selectWorkflow).toBe('选择工作流|Select workflow')
    expect(copy.inputSchema).toBe('输入结构|Input Schema')
    expect(copy.sampleDispatch).toBe('示例分发|Sample Dispatch')
    expect(copy.removeBindingTitle).toBe('移除绑定|Remove binding')
    expect(copy.unresolvedSuffix).toBe('未解析|unresolved')
  })
})
