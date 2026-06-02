// Add console.log to the workflow module to see what happens
import { describe, it, expect } from 'vitest'

describe('workflow isolation', () => {
  it('loads workflow module', async () => {
    const m = await import('./workflow-agent-tools.js')
    console.log("KEYS:", Object.keys(m))
    console.log("DEF exists:", m.WORKFLOW_AGENT_TOOL_DEFINITIONS !== undefined)
    console.log("DEF isArray:", Array.isArray(m.WORKFLOW_AGENT_TOOL_DEFINITIONS))
    if (m.WORKFLOW_AGENT_TOOL_DEFINITIONS) {
      console.log("DEF keys:", Object.keys(m.WORKFLOW_AGENT_TOOL_DEFINITIONS))
    }
  })
})
