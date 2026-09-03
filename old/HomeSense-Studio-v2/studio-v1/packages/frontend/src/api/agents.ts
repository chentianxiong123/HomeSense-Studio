import { api } from './index'

export type AgentRecord = Awaited<ReturnType<typeof api.agents.listInstances>>['instances'][number]

export const agentApi = {
  list: () => api.agents.listInstances(),
  async getByTarget(target: string): Promise<AgentRecord | null> {
    const result = await api.agents.listInstances()
    return result.instances.find((item) => String(item.id) === target || item.slug === target) ?? null
  },
}
