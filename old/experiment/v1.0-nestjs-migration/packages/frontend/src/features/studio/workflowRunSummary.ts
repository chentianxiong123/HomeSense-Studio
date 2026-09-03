export type SummaryTone = 'success' | 'error' | 'warning' | 'neutral'

export interface WorkflowRunnerStepLike {
  nodeId: string
  nodeType: string
  status: 'running' | 'succeeded' | 'failed' | 'skipped'
  inputs?: Record<string, unknown>
  resolvedInputs?: Record<string, unknown>
  outputs?: Record<string, unknown>
  error?: string
  durationMs?: number
  attempts?: number
  retryErrors?: string[]
}

export interface WorkflowStepSummary {
  title: string
  kind: 'device_capability' | 'executor' | 'answer' | 'subflow' | 'generic'
  tone: SummaryTone
  device?: {
    name: string
    detail: string
    status: 'online' | 'offline' | 'unknown'
  }
  phases?: Array<{
    label: string
    value: string
    tone: SummaryTone
  }>
  effect?: string
  changedFields?: string[]
  substeps?: Array<{
    title: string
    detail: string
    tone: SummaryTone
    duration?: string
  }>
  rows: Array<{ label: string; value: string }>
}

type Labeler = (zh: string, en: string) => string

export function buildWorkflowStepSummary(step: WorkflowRunnerStepLike, label: Labeler): WorkflowStepSummary | null {
  const outputs = asRecord(step.outputs)
  const result = asRecord(outputs.result)

  if (step.nodeType === 'executor_call') {
    return summarizeExecutorResult(result, label, step.status, asRecord(step.resolvedInputs ?? step.inputs))
  }

  if (step.nodeType === 'device_capability') {
    return summarizeDeviceCapabilityResult(outputs, label, step.status)
  }

  if (step.nodeType === 'answer') {
    const answer = stringifyValue(outputs.answer)
    return answer
      ? {
          title: label('回答', 'Answer'),
          kind: 'answer',
          tone: 'success',
          rows: [{ label: label('内容', 'Message'), value: answer }],
        }
      : null
  }

  if (step.nodeType === 'subflow') {
    const subflow = asRecord(outputs.subflow)
    const nestedTrace = readArray(subflow.trace)
    return Object.keys(subflow).length > 0
      ? {
          title: label('子流程', 'Subflow'),
          kind: 'subflow',
          tone: readToneFromStatus(String(subflow.status ?? step.status)),
          substeps: nestedTrace.slice(0, 6).map((item) => {
            const row = asRecord(item)
            return {
              title: stringifyValue(row.node_type || row.node_id) || label('步骤', 'Step'),
              detail: [
                stringifyValue(row.status),
                stringifyValue(row.error),
              ].filter(Boolean).join(' · '),
              tone: traceStateTone(String(row.status)),
              duration: stringifyValue(row.duration_ms) ? `${stringifyValue(row.duration_ms)}ms` : undefined,
            }
          }),
          rows: compactRows([
            [label('工作流', 'Workflow'), stringifyValue(subflow.workflow_id)],
            [label('运行', 'Run'), stringifyValue(subflow.run_id)],
            [label('状态', 'Status'), stringifyValue(subflow.status)],
            [label('节点', 'Trace'), stringifyValue(subflow.trace_count)],
          ]),
        }
      : null
  }

  return null
}

function summarizeExecutorResult(
  result: Record<string, unknown>,
  label: Labeler,
  stepStatus: WorkflowRunnerStepLike['status'],
  resolvedInputs: Record<string, unknown>,
): WorkflowStepSummary | null {
  if (!Object.keys(result).length) return null

  const castBridgeSummary = summarizeCastBridgeResult(result, label, stepStatus, resolvedInputs)
  if (castBridgeSummary) return castBridgeSummary

  const adapterResult = asRecord(result.adapter_result)
  if (adapterResult.status) {
    if (adapterResult.protocol === 'a2a') {
      const request = asRecord(adapterResult.request)
      return {
        title: label('远程分发', 'Remote Dispatch'),
        kind: 'executor',
        tone: readToneFromStatus(String(adapterResult.status)),
        rows: compactRows([
          [label('目标', 'Target'), stringifyValue(result.target)],
          [label('分发', 'Dispatch'), stringifyValue(result.status)],
          ['A2A', stringifyValue(adapterResult.status)],
          [label('方法', 'Method'), stringifyValue(request.method)],
          [label('端点', 'Endpoint'), stringifyValue(adapterResult.endpoint) || 'dry-run'],
        ]),
      }
    }

    const adapterData = asRecord(adapterResult.data)
    const draft = asRecord(adapterData.draft)
    if (draft.draft_id) {
      return {
        title: label('适配器分发', 'Adapter Dispatch'),
        kind: 'executor',
        tone: readToneFromStatus(String(adapterResult.status)),
        rows: compactRows([
          [label('目标', 'Target'), stringifyValue(result.target)],
          [label('分发', 'Dispatch'), stringifyValue(result.status)],
          [label('草稿', 'Draft'), stringifyValue(draft.draft_id)],
          [label('标题', 'Title'), stringifyValue(asRecord(draft.metadata).title)],
          [label('来源', 'Source'), stringifyValue(asRecord(draft.upload).source_path)],
        ]),
      }
    }

    if (adapterData.launched) {
      return {
        title: label('设备动作', 'Device Action'),
        kind: 'executor',
        tone: readToneFromStatus(String(adapterResult.status)),
        rows: compactRows([
          [label('目标', 'Target'), stringifyValue(result.target)],
          [label('分发', 'Dispatch'), stringifyValue(result.status)],
          [label('启动', 'Launched'), stringifyValue(adapterData.launched)],
          [label('当前', 'Active'), stringifyValue(adapterData.active_package)],
        ]),
      }
    }
  }

  const data = asRecord(result.data)
  const payload = asRecord(data.data)
  const bilibiliPayload = Array.isArray(payload.items) ? payload : asRecord(payload.data)
  if (Array.isArray(bilibiliPayload.items)) {
    const firstItem = asRecord(bilibiliPayload.items[0])
    return {
      title: label('Bilibili 查询', 'Bilibili Query'),
      kind: 'executor',
      tone: readToneFromStatus(String(result.status)),
      rows: compactRows([
        [label('状态', 'Status'), stringifyValue(result.status)],
        [label('条数', 'Items'), String(bilibiliPayload.items.length)],
        [label('首条', 'First'), stringifyValue(firstItem.title || firstItem.name || firstItem.bvid || firstItem.id)],
        [label('作者', 'Owner'), stringifyValue(asRecord(firstItem.owner).name || asRecord(firstItem.owner).id)],
      ]),
    }
  }

  const draft = asRecord(data.draft)
  if (draft.draft_id) {
    return {
      title: label('CLI 草稿', 'CLI Draft'),
      kind: 'executor',
      tone: readToneFromStatus(String(result.status)),
      rows: compactRows([
        [label('状态', 'Status'), stringifyValue(result.status)],
        [label('草稿', 'Draft'), stringifyValue(draft.draft_id)],
        [label('标题', 'Title'), stringifyValue(asRecord(draft.metadata).title)],
        [label('来源', 'Source'), stringifyValue(asRecord(draft.upload).source_path)],
        ['dry_run', stringifyValue(asRecord(draft.upload).dry_run)],
      ]),
    }
  }

  if (data.launched) {
    return {
      title: label('设备动作', 'Device Action'),
      kind: 'executor',
      tone: readToneFromStatus(String(result.status)),
      rows: compactRows([
        [label('状态', 'Status'), stringifyValue(result.status)],
        [label('启动', 'Launched'), stringifyValue(data.launched)],
        [label('当前', 'Active'), stringifyValue(data.active_package)],
      ]),
    }
  }

  if (Array.isArray(result.results)) {
    return {
      title: label('编译计划', 'Compiled Plan'),
      kind: 'executor',
      tone: 'success',
      rows: compactRows([
        [label('计划', 'Plan'), stringifyValue(result.plan_id)],
        [label('步骤', 'Steps'), String(result.results.length)],
        [label('可执行', 'Executable'), stringifyValue(result.executable)],
      ]),
    }
  }

  if (result.target || result.dispatch_id) {
    return {
      title: label('能力分发', 'Capability Dispatch'),
      kind: 'executor',
      tone: readToneFromStatus(String(result.status)),
      rows: compactRows([
        [label('目标', 'Target'), stringifyValue(result.target)],
        [label('状态', 'Status'), stringifyValue(result.status)],
        [label('模式', 'Mode'), stringifyValue(result.execution_mode)],
      ]),
    }
  }

  return null
}

function summarizeCastBridgeResult(
  result: Record<string, unknown>,
  label: Labeler,
  stepStatus: WorkflowRunnerStepLike['status'],
  resolvedInputs: Record<string, unknown>,
): WorkflowStepSummary | null {
  const data = asRecord(result.data)
  const executorParams = asRecord(resolvedInputs.params)
  const cliName = stringifyValue(executorParams.cli_name)
  const cliAction = stringifyValue(executorParams.action)
  const sourceUrl = stringifyValue(data.source_url)
  const supportedActions = readArray(data.supported_actions).map(String)
  const isCastBridge = String(result.error ?? '').startsWith('CAST_')
    || cliName === 'dlna-cast-cli'
    || cliName === 'speaker-cast-cli'
    || data.adapter === 'bilibili_music'
    || supportedActions.includes('start_cast')
    || sourceUrl.includes('/api/v1/cast/')
    || sourceUrl.includes('/api/v1/speaker/')
    || sourceUrl.includes('/api/v1/music/')

  if (!isCastBridge) return null

  const isError = result.status === 'error' || stepStatus === 'failed'
  const serviceReachable = data.service_reachable
  const tone: SummaryTone = isError
    ? 'error'
    : serviceReachable === false
      ? 'warning'
      : 'success'
  const payloadSummary = summarizeCastPayload(data.data)
  const title = castBridgeTitle(sourceUrl, data.adapter, cliName, cliAction, label)
  const serviceValue = serviceReachable === true
    ? label('在线', 'Online')
    : serviceReachable === false
      ? label('离线', 'Offline')
      : label('已调用', 'Called')

  return {
    title,
    kind: 'executor',
    tone,
    phases: [
      {
        label: label('能力适配', 'Adapter'),
        value: isError ? label('失败', 'Failed') : label('可调用', 'Ready'),
        tone: isError ? 'error' : 'success',
      },
      {
        label: label('bilibili-music 服务', 'bilibili-music Service'),
        value: serviceValue,
        tone: serviceReachable === false ? 'warning' : tone,
      },
    ],
    effect: isError
      ? stringifyValue(result.message ?? result.error)
      : serviceReachable === false
        ? label('投屏能力已接入，但 bilibili-music 服务当前不可达。', 'Casting capability is wired, but the bilibili-music service is currently unreachable.')
        : label('通过投屏能力调用 DLNA、音箱或音乐链路。', 'Casting capability invoked DLNA, speaker, or music path.'),
    rows: compactRows([
      [label('状态', 'Status'), stringifyValue(result.status)],
      [label('地址', 'Endpoint'), stringifyValue(data.base_url ?? sourceUrl)],
      [label('动作', 'Action'), cliAction || (sourceUrl ? sourceUrl.split('/api/v1/')[1] ?? sourceUrl : 'health')],
      [label('能力数', 'Actions'), supportedActions.length ? String(supportedActions.length) : ''],
      [label('返回', 'Payload'), payloadSummary],
      [label('错误', 'Error'), stringifyValue(result.message ?? asRecord(data.error).message ?? result.error)],
    ]),
  }
}

function summarizeDeviceCapabilityResult(
  outputs: Record<string, unknown>,
  label: Labeler,
  stepStatus: WorkflowRunnerStepLike['status'],
): WorkflowStepSummary | null {
  const rehearsal = asRecord(outputs.rehearsal)
  const result = asRecord(outputs.result)
  if (!Object.keys(rehearsal).length && !Object.keys(result).length) return null

  const rehearsalData = asRecord(rehearsal.data ?? rehearsal)
  const resultData = asRecord(result.data ?? result)
  const device = buildDeviceSummary(rehearsalData, resultData)
  const rehearsalTone = rehearsalPassed(rehearsal, rehearsalData) ? 'success' : 'warning'
  const executionTone = outputs.trigger === false
      ? 'warning'
      : stepStatus === 'failed' || result.status === 'error' || resultData.error
        ? 'error'
        : 'success'
  const capability = stringifyValue(
    rehearsalData.capability
      ?? rehearsalData.capability_id
      ?? resultData.capability
      ?? resultData.capability_id,
  )
  const effect = stringifyValue(
    rehearsalData.effect_summary
      ?? asRecord(rehearsalData.projection).effect_summary
      ?? rehearsalData.predicted_effect
      ?? rehearsalData.next_step,
  )
  const changedFields = readChangedFields(rehearsalData)

  return {
    title: label('设备能力', 'Device Capability'),
    kind: 'device_capability',
    tone: executionTone === 'error' ? 'error' : rehearsalTone,
    device,
    phases: [
      {
        label: label('沙箱演练', 'Rehearsal'),
        value: rehearsalTone === 'success' ? label('通过', 'Passed') : label('阻塞', 'Blocked'),
        tone: rehearsalTone,
      },
      {
        label: label('真实执行', 'Execution'),
        value: executionTone === 'success'
          ? label('完成', 'Done')
          : executionTone === 'warning'
            ? label('未执行', 'Blocked')
            : label('失败', 'Failed'),
        tone: executionTone,
      },
    ],
    effect,
    changedFields,
    rows: compactRows([
      [label('设备 ID', 'Device ID'), stringifyValue(rehearsalData.device_id ?? resultData.device_id ?? asRecord(rehearsalData.device).id ?? asRecord(resultData.device).id)],
      [label('能力', 'Capability'), capability],
      [label('来源', 'Source'), stringifyValue(rehearsalData.source ?? resultData.source)],
      [label('参数', 'Arguments'), stringifyValue(rehearsalData.arguments ?? resultData.arguments)],
      [label('输出', 'Output'), stringifyValue(resultData.output)],
      [label('错误', 'Error'), stringifyValue(result.error ?? result.message ?? rehearsal.error ?? rehearsal.message)],
    ]),
  }
}

function buildDeviceSummary(
  rehearsalData: Record<string, unknown>,
  resultData: Record<string, unknown>,
): WorkflowStepSummary['device'] | undefined {
  const rawDevice = asRecord(rehearsalData.device)
  const executionDevice = asRecord(resultData.device)
  const device = Object.keys(rawDevice).length ? rawDevice : executionDevice
  if (!Object.keys(device).length) return undefined

  const card = asRecord(device.card)
  const display = asRecord(card.display)
  const room = asRecord(card.room)
  const onlineCheck = asRecord(device.online_check)
  const online = onlineCheck.online
  const status = String(display.status ?? (online === true ? 'online' : online === false ? 'offline' : 'unknown'))
  return {
    name: stringifyValue(display.title ?? device.name) || stringifyValue(device.id),
    detail: [stringifyValue(room.name ?? device.room), stringifyValue(device.device_type)].filter(Boolean).join(' · '),
    status: status === 'online' || status === 'offline' ? status : 'unknown',
  }
}

function rehearsalPassed(rehearsal: Record<string, unknown>, rehearsalData: Record<string, unknown>): boolean {
  if (rehearsal.status === 'error') return false
  if (rehearsalData.ok === false || rehearsalData.executable === false) return false
  return true
}

function readChangedFields(rehearsalData: Record<string, unknown>): string[] {
  const projection = asRecord(rehearsalData.projection)
  const fields: unknown[] = Array.isArray(rehearsalData.changed_fields)
    ? rehearsalData.changed_fields
    : Array.isArray(projection.changed_fields)
      ? projection.changed_fields
      : []
  return fields
    .map((field) => typeof field === 'string' ? field : stringifyValue(field))
    .filter(Boolean)
}

function castBridgeTitle(sourceUrl: string, adapter: unknown, cliName: string, action: string, label: Labeler): string {
  if (adapter === 'bilibili_music' && cliName === 'speaker-cast-cli') return label('音箱投屏适配', 'Speaker Cast Adapter')
  if (adapter === 'bilibili_music') return label('DLNA 投屏适配', 'DLNA Cast Adapter')
  if (action === 'discover_devices') return label('DLNA 设备发现', 'DLNA Discovery')
  if (action === 'start_cast') return label('DLNA 投屏', 'DLNA Cast')
  if (action === 'control_cast') return label('投屏控制', 'Cast Control')
  if (action === 'play_bilibili') return label('音箱投屏', 'Speaker Cast')
  if (action === 'list_speakers') return label('音箱列表', 'Speaker List')
  if (action === 'control_playback' || action === 'get_volume' || action === 'set_volume') return label('音箱控制', 'Speaker Control')
  if (action === 'search_bilibili' || action === 'resolve_audio') return label('音乐解析', 'Music Resolve')
  if (sourceUrl.includes('/api/v1/cast/devices')) return label('DLNA 设备发现', 'DLNA Discovery')
  if (sourceUrl.includes('/api/v1/cast/start')) return label('DLNA 投屏', 'DLNA Cast')
  if (sourceUrl.includes('/api/v1/cast/control')) return label('投屏控制', 'Cast Control')
  if (sourceUrl.includes('/api/v1/speaker/play')) return label('音箱投屏', 'Speaker Cast')
  if (sourceUrl.includes('/api/v1/speaker/')) return label('音箱控制', 'Speaker Control')
  if (sourceUrl.includes('/api/v1/music/')) return label('音乐解析', 'Music Resolve')
  return label('投屏能力', 'Cast Capability')
}

function summarizeCastPayload(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item(s)`
  const record = asRecord(value)
  if (Object.keys(record).length === 0) return ''
  if (Array.isArray(record.devices)) return `${record.devices.length} device(s)`
  if (Array.isArray(record.episodes)) return `${record.episodes.length} episode(s)`
  return stringifyValue(record)
}

function readToneFromStatus(status: string): SummaryTone {
  if (status === 'success' || status === 'succeeded' || status === 'ok') return 'success'
  if (status === 'error' || status === 'failed') return 'error'
  if (status === 'blocked' || status === 'skipped') return 'warning'
  return 'neutral'
}

function traceStateTone(status: string): SummaryTone {
  if (status === 'succeeded') return 'success'
  if (status === 'failed') return 'error'
  if (status === 'skipped') return 'warning'
  return 'neutral'
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function compactRows(rows: Array<[string, string]>): Array<{ label: string; value: string }> {
  return rows
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => ({ label, value }))
}
