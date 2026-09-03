import { describe, expect, it } from 'vitest'
import { buildWorkflowRunHistorySteps, parseWorkflowRunTrace } from './workflowRunHistory'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('workflowRunHistory', () => {
  it('parses persisted workflow trace json into runner step models', () => {
    const steps = parseWorkflowRunTrace(JSON.stringify([
      {
        node_id: '1',
        node_type: 'start',
        status: 'succeeded',
        outputs: { trigger: true },
        duration_ms: 5,
      },
      {
        node_id: '2',
        node_type: 'code',
        status: 'failed',
        outputs: {},
        error: 'boom',
        duration_ms: 3,
        attempts: 2,
        retry_errors: ['temporary'],
      },
    ]))

    expect(steps).toEqual([
      {
        nodeId: '1',
        nodeType: 'start',
        status: 'succeeded',
        outputs: { trigger: true },
        error: undefined,
        durationMs: 5,
        attempts: undefined,
        retryErrors: undefined,
        compensationTaskId: undefined,
      },
      {
        nodeId: '2',
        nodeType: 'code',
        status: 'failed',
        outputs: {},
        error: 'boom',
        durationMs: 3,
        attempts: 2,
        retryErrors: ['temporary'],
        compensationTaskId: undefined,
      },
    ])
  })

  it('builds display summaries for persisted answer trace steps', () => {
    const views = buildWorkflowRunHistorySteps(JSON.stringify([
      {
        node_id: '3',
        node_type: 'answer',
        status: 'succeeded',
        outputs: { answer: 'done' },
        duration_ms: 8,
      },
    ]), label)

    expect(views[0].summary).toMatchObject({
      title: '回答|Answer',
      kind: 'answer',
      rows: [{ label: '内容|Message', value: 'done' }],
    })
  })
})
