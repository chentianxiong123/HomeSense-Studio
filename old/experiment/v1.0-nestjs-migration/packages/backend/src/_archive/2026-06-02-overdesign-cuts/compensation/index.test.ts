import { describe, expect, it } from 'vitest'
import { createInMemoryDb, FakeEventBus } from '../../test-support/index.js'
import { CompensationService } from './index.js'

describe('CompensationService', () => {
  it('previews workflow node failures as repair observations instead of executable retries', () => {
    const db = createInMemoryDb()
    const service = new CompensationService(
      () => db,
      new FakeEventBus(),
      { call: async () => ({}), list: () => [] },
      { get: () => undefined },
      { get: () => undefined },
    )

    const task = service.recordWorkflowNodeFailure({
      workflow_id: 7,
      run_id: 12,
      node_id: '3',
      node_type: 'code',
      label: 'Explode',
      error: 'boom',
    })
    const preview = service.preview(task)

    expect(preview.can_execute).toBe(false)
    expect(preview.estimated_impact).toBe('工作流失败修复线索')
    expect(preview.checks).toEqual(expect.arrayContaining([
      { name: 'workflow_context', passed: true, message: '工作流 #7 · 节点 Explode · code' },
      { name: 'failure_error', passed: false, message: 'boom' },
      {
        name: 'observation_only',
        passed: false,
        message: '失败观察任务，不直接重试；请根据预览修复节点或重新运行工作流。',
      },
    ]))
  })
})
