import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLIBridge } from './cli-bridge.js'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const skillsDir = path.resolve(moduleDir, '../../../../../skills')

function loadBridge(): CLIBridge {
  const bridge = new CLIBridge()
  bridge.loadDiskExecutors(skillsDir)
  return bridge
}

describe('real Bilibili CLI bridge', () => {
  it('loads the real Bilibili CLI action surface instead of the old draft-upload stub', async () => {
    const bridge = loadBridge()
    const executor = bridge.listExecutors().find((item) => item.name === 'bilibili-cli')

    expect(executor).toEqual(expect.objectContaining({
      name: 'bilibili-cli',
      source: 'third_party',
      protocol: 'in_process_module',
    }))
    expect(executor?.actions).toEqual(expect.arrayContaining(['health', 'status', 'search', 'video', 'hot', 'rank']))
    expect(executor?.actions).not.toContain('prepare_upload')

    const health = await bridge.run('bilibili-cli', 'health', {})
    expect(health.status).toBe('success')
    expect(health.data).toEqual(expect.objectContaining({
      adapter: 'jackwener/bilibili-cli',
      mode: 'real_cli_bridge',
      entrypoint: 'uv run bili',
    }))
  })
})
