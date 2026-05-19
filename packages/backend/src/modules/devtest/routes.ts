import type { FastifyInstance } from 'fastify'
import { cliBridge } from '../cli-bridge/index.js'
import { serviceRegistry } from '../service-registry/index.js'
import { memoryKernel } from '../memory-kernel/index.js'
import { eventBus } from '../event-bus/index.js'

interface SmokeStep {
  order: number
  label: string
  tool: string
  action: string
  params: Record<string, unknown>
  status: 'success' | 'error' | 'skipped'
  duration_ms: number
  result?: unknown
  error?: string
}

const SMOKE_SEQUENCE: Array<Omit<SmokeStep, 'status' | 'duration_ms' | 'result' | 'error'>> = [
  { order: 1, label: 'Run Mijia power scene', tool: 'mi-cli', action: 'scene_execute', params: { scene_name: '东芝电视开机' } },
  { order: 2, label: 'Ask XiaoAi hub to prepare TV path', tool: 'mi-cli', action: 'speaker_execute', params: { text: '打开东芝电视和机顶盒', silent: true } },
  { order: 3, label: 'Ensure ADB connected', tool: 'adb-cli', action: 'ensure_connected', params: {} },
  { order: 4, label: 'List installed packages', tool: 'adb-cli', action: 'list_packages', params: { keyword: 'bili' } },
  { order: 5, label: 'Launch Bilibili TV', tool: 'adb-cli', action: 'launch_app', params: { package: 'com.xiaodianshi.tv.yst' } },
  { order: 6, label: 'Notify via Feishu (channel)', tool: 'service:channel.feishu.send', action: 'invoke', params: { text: 'Smoke test passed: Toshiba TV Bilibili ready' } },
  { order: 7, label: 'Prepare Bilibili dry-run upload', tool: 'bilibili-cli', action: 'prepare_upload', params: { title: 'HomeSense smoke', source_path: './exports/smoke.mp4', dry_run: true } },
]

export async function devtestRoutes(app: FastifyInstance) {
  app.post('/api/devtest/smoke', async () => {
    const intent = 'devtest.smoke.watch_bilibili'
    const started = Date.now()
    const steps: SmokeStep[] = []

    eventBus.fire('devtest_smoke_started', { intent, started_at: new Date().toISOString() })

    for (const spec of SMOKE_SEQUENCE) {
      const stepStart = Date.now()
      let status: 'success' | 'error' | 'skipped' = 'skipped'
      let result: unknown = undefined
      let error: string | undefined

      try {
        if (spec.tool.startsWith('service:')) {
          const serviceName = spec.tool.slice('service:'.length)
          if (!serviceRegistry.has(serviceName)) {
            status = 'skipped'
            error = 'service not registered'
          } else {
            result = await serviceRegistry.call(serviceName, spec.params)
            status = 'success'
          }
        } else if (cliBridge.hasExecutor(spec.tool)) {
          const cliResult = await cliBridge.run(spec.tool, spec.action, spec.params)
          if (cliResult.status === 'success') {
            status = 'success'
            result = cliResult.data
          } else {
            status = 'error'
            error = cliResult.error
          }
        } else {
          status = 'skipped'
          error = `executor not registered: ${spec.tool}`
        }
      } catch (err) {
        status = 'error'
        error = (err as Error).message
      }

      const duration_ms = Date.now() - stepStart
      steps.push({ ...spec, status, duration_ms, result, error })

      try {
        memoryKernel.observeOutcome({
          intent,
          tool: spec.tool,
          action: spec.action,
          success: status === 'success',
          error,
        })
      } catch {}
    }

    const totalSuccess = steps.filter((s) => s.status === 'success').length
    const totalError = steps.filter((s) => s.status === 'error').length
    const totalSkipped = steps.filter((s) => s.status === 'skipped').length
    const overall: 'success' | 'partial' | 'failed' =
      totalError === 0 && totalSkipped === 0 ? 'success' : totalError > 0 ? 'failed' : 'partial'

    eventBus.fire('devtest_smoke_completed', {
      intent,
      duration_ms: Date.now() - started,
      overall,
      success: totalSuccess,
      error: totalError,
      skipped: totalSkipped,
    })

    return {
      status: 'success',
      intent,
      duration_ms: Date.now() - started,
      overall,
      summary: { success: totalSuccess, error: totalError, skipped: totalSkipped, total: steps.length },
      steps,
    }
  })

  app.get('/api/devtest/smoke/sequence', async () => {
    return { sequence: SMOKE_SEQUENCE }
  })
}
