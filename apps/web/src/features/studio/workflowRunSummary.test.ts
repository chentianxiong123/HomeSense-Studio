import { describe, expect, it } from 'vitest'
import { buildWorkflowStepSummary } from './workflowRunSummary'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('buildWorkflowStepSummary', () => {
  it('builds a device capability card summary with validation and execution phases', () => {
    const summary = buildWorkflowStepSummary({
      nodeId: '2',
      nodeType: 'device_capability',
      status: 'succeeded',
      outputs: {
        trigger: true,
        validation: {
          status: 'success',
          data: {
            ok: true,
            executable: true,
            device_id: 7,
            device: {
              name: '客厅机顶盒',
              device_type: 'tv_box',
              card: {
                room: { name: '客厅' },
                display: { title: '客厅机顶盒', status: 'online' },
              },
            },
            capability_id: 'mi.ir_key',
            capability: '遥控按键',
            source: 'mi',
            arguments: { key: 'BACK' },
            effect_summary: 'IR key BACK would be pressed.',
            changed_fields: ['last_ir_key'],
          },
        },
        result: {
          device_id: 7,
          capability_id: 'mi.ir_key',
          capability: '遥控按键',
          source: 'mi',
          arguments: { key: 'BACK' },
          output: { ok: true },
        },
      },
    }, label)

    expect(summary).toMatchObject({
      title: '设备能力|Device Capability',
      kind: 'device_capability',
      tone: 'success',
      device: {
        name: '客厅机顶盒',
        detail: '客厅 · tv_box',
        status: 'online',
      },
      effect: 'IR key BACK would be pressed.',
      changedFields: ['last_ir_key'],
    })
    expect(summary?.phases).toEqual([
      { label: '预览校验|Validation', value: '通过|Passed', tone: 'success' },
      { label: '真实执行|Execution', value: '完成|Done', tone: 'success' },
    ])
    expect(summary?.rows).toContainEqual({ label: '能力|Capability', value: '遥控按键' })
  })

  it('marks blocked validation as warning and execution as blocked', () => {
    const summary = buildWorkflowStepSummary({
      nodeId: '2',
      nodeType: 'device_capability',
      status: 'failed',
      outputs: {
        trigger: false,
        validation: {
          status: 'success',
          data: {
            ok: false,
            executable: false,
            device_id: 7,
            capability_id: 'mi.ir_key',
            missing_arguments: ['key_id'],
            next_step: 'Ask for missing argument(s): key_id',
          },
        },
      },
    }, label)

    expect(summary?.tone).toBe('warning')
    expect(summary?.phases).toEqual([
      { label: '预览校验|Validation', value: '阻塞|Blocked', tone: 'warning' },
      { label: '真实执行|Execution', value: '未执行|Blocked', tone: 'warning' },
    ])
    expect(summary?.effect).toBe('Ask for missing argument(s): key_id')
  })

  it('expands nested subflow trace into substeps', () => {
    const summary = buildWorkflowStepSummary({
      nodeId: '3',
      nodeType: 'subflow',
      status: 'succeeded',
      outputs: {
        subflow: {
          workflow_id: 34,
          run_id: 99,
          status: 'succeeded',
          trace_count: 2,
          trace: [
            { node_id: 'a', node_type: 'start', status: 'succeeded', duration_ms: 3 },
            { node_id: 'b', node_type: 'answer', status: 'succeeded', duration_ms: 5, outputs: { answer: 'done' } },
          ],
        },
      },
    }, label)

    expect(summary?.kind).toBe('subflow')
    expect(summary?.substeps).toEqual([
      { title: 'start', detail: 'succeeded', tone: 'success', duration: '3ms' },
      { title: 'answer', detail: 'succeeded', tone: 'success', duration: '5ms' },
    ])
  })

  it('summarizes DLNA cast adapter health without pretending the external service is online', () => {
    const summary = buildWorkflowStepSummary({
      nodeId: '2',
      nodeType: 'executor_call',
      status: 'succeeded',
      resolvedInputs: {
        executor_name: 'cli.invoke',
        params: {
          cli_name: 'dlna-cast-cli',
          action: 'health',
          params: { base_url: 'http://127.0.0.1:28974' },
        },
      },
      outputs: {
        result: {
          status: 'success',
          data: {
            ready: true,
            adapter: 'bilibili_music',
            base_url: 'http://127.0.0.1:28974',
            service_reachable: false,
            supported_actions: ['health', 'discover_devices', 'start_cast', 'play_bilibili'],
          },
        },
      },
    }, label)

    expect(summary).toMatchObject({
      title: 'DLNA 投屏适配|DLNA Cast Adapter',
      kind: 'executor',
      tone: 'warning',
      effect: '投屏能力已接入，但 bilibili-music 服务当前不可达。|Casting capability is wired, but the bilibili-music service is currently unreachable.',
    })
    expect(summary?.phases).toEqual([
      { label: '能力适配|Adapter', value: '可调用|Ready', tone: 'success' },
      { label: 'bilibili-music 服务|bilibili-music Service', value: '离线|Offline', tone: 'warning' },
    ])
    expect(summary?.rows).toContainEqual({ label: '能力数|Actions', value: '4' })
  })

  it('summarizes real Bilibili CLI list payloads without draft-upload assumptions', () => {
    const summary = buildWorkflowStepSummary({
      nodeId: '7',
      nodeType: 'executor_call',
      status: 'succeeded',
      outputs: {
        result: {
          status: 'success',
          data: {
            status: 'success',
            data: {
              schema_version: '1',
              data: {
                items: [
                  {
                    bvid: 'BV1test',
                    title: 'HomeSense Studio demo',
                    owner: { name: 'tester' },
                  },
                ],
              },
            },
          },
        },
      },
    }, label)

    expect(summary).toMatchObject({
      title: 'Bilibili 查询|Bilibili Query',
      kind: 'executor',
      tone: 'success',
    })
    expect(summary?.rows).toContainEqual({ label: '条数|Items', value: '1' })
    expect(summary?.rows).toContainEqual({ label: '首条|First', value: 'HomeSense Studio demo' })
  })

  it('summarizes failed DLNA cast actions as failed executor trace cards', () => {
    const summary = buildWorkflowStepSummary({
      nodeId: '3',
      nodeType: 'executor_call',
      status: 'failed',
      error: 'bilibili-music service is not reachable at http://127.0.0.1:9: fetch failed',
      resolvedInputs: {
        executor_name: 'cli.invoke',
        params: {
          cli_name: 'dlna-cast-cli',
          action: 'discover_devices',
          params: { base_url: 'http://127.0.0.1:9' },
        },
      },
      outputs: {
        result: {
          status: 'error',
          error: 'CAST_SERVICE_UNAVAILABLE',
          message: 'bilibili-music service is not reachable at http://127.0.0.1:9: fetch failed',
        },
      },
    }, label)

    expect(summary).toMatchObject({
      title: 'DLNA 设备发现|DLNA Discovery',
      kind: 'executor',
      tone: 'error',
      effect: 'bilibili-music service is not reachable at http://127.0.0.1:9: fetch failed',
    })
    expect(summary?.rows).toContainEqual({ label: '动作|Action', value: 'discover_devices' })
    expect(summary?.rows).toContainEqual({ label: '错误|Error', value: 'bilibili-music service is not reachable at http://127.0.0.1:9: fetch failed' })
  })
})
