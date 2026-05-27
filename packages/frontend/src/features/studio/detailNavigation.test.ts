import { describe, expect, it } from 'vitest'
import { buildSkillDetailTabs, buildWorkflowDetailTabs } from './detailNavigation'

describe('buildWorkflowDetailTabs', () => {
  it('builds stable workflow tabs for overview, editor, and runs', () => {
    const tabs = buildWorkflowDetailTabs(7, (zh, en) => `${zh}|${en}`)

    expect(tabs).toEqual([
      { route: '/studio/workflows/7/overview', label: '概览|Overview' },
      { route: '/studio/workflows/7/editor', label: '编排器|Editor' },
      { route: '/studio/workflows/7/runs', label: '运行记录|Runs' },
    ])
  })
})

describe('buildSkillDetailTabs', () => {
  it('encodes skill names and keeps overview/prompt tabs stable', () => {
    const tabs = buildSkillDetailTabs('cli/adb.launch', (zh, en) => `${zh}|${en}`)

    expect(tabs).toEqual([
      { route: '/assets/skills/cli%2Fadb.launch/overview', label: '概览|Overview' },
      { route: '/assets/skills/cli%2Fadb.launch/prompt', label: '完整提示词|Prompt' },
    ])
  })
})
