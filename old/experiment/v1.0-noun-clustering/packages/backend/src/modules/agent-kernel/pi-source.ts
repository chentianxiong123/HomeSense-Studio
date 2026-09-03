import type { AgentEvent, AgentMessage, AgentTool } from '@earendil-works/pi-agent-core'

export type PiSourceAgentEvent = AgentEvent
export type PiSourceAgentMessage = AgentMessage
export type PiSourceAgentTool = AgentTool

export const piSourceKernelReference = {
  packageName: '@earendil-works/pi-agent-core',
  mode: 'local-file-source',
} as const
