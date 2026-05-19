import { getDb } from '../../db/index.js'

export type AgentProfile = 'entertainment' | 'productivity' | 'maintainer' | 'remote_bot'
export type AgentSurface = 'chat' | 'studio' | 'scheduler' | 'remote'
export type AgentStatus = 'active' | 'paused' | 'archived'

export interface AgentInstance {
  id: number
  slug: string
  name: string
  profile: AgentProfile
  surface: AgentSurface
  memory_scope: string
  tool_scope_json: string
  permissions_json: string
  default_channel: string
  status: AgentStatus
  extra_config_json: string
  created_at: string
  updated_at: string
}

interface SeedAgentInput {
  slug: string
  name: string
  profile: AgentProfile
  surface: AgentSurface
  memory_scope: string
  tool_scope: string[]
  permissions: Record<string, unknown>
  default_channel: string
  extra_config?: Record<string, unknown>
}

const DEFAULT_AGENTS: SeedAgentInput[] = [
  {
    slug: 'chat-entertainment',
    name: 'Entertainment Chat Agent',
    profile: 'entertainment',
    surface: 'chat',
    memory_scope: 'home.entertainment',
    tool_scope: ['mi-cli', 'adb-cli'],
    permissions: { devices: ['tv', 'speaker', 'set_top_box'], remotes: true },
    default_channel: 'web',
  },
  {
    slug: 'studio-productivity',
    name: 'Studio Productivity Agent',
    profile: 'productivity',
    surface: 'studio',
    memory_scope: 'studio.productivity',
    tool_scope: ['workflow', 'mi-cli', 'adb-cli', 'bilibili-cli', 'external-agent'],
    permissions: { workflows: true, external_agents: true },
    default_channel: 'web',
  },
  {
    slug: 'remote-bot',
    name: 'Remote Bot Agent',
    profile: 'remote_bot',
    surface: 'remote',
    memory_scope: 'home.remote',
    tool_scope: ['mi-cli', 'adb-cli'],
    permissions: { remote_channels: ['feishu', 'wechat', 'telegram', 'xiaoai'] },
    default_channel: 'feishu',
  },
]

type GetDbFn = () => ReturnType<typeof getDb>

class AgentInstanceService {
  constructor(private readonly getDb: GetDbFn = getDb) {}

  ensureDefaults(): void {
    const db = this.getDb()

    for (const agent of DEFAULT_AGENTS) {
      db.prepare(
        `INSERT INTO agent_instances (
          slug, name, profile, surface, memory_scope, tool_scope_json,
          permissions_json, default_channel, status, extra_config_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
        ON CONFLICT(slug) DO UPDATE SET
          name=excluded.name,
          profile=excluded.profile,
          surface=excluded.surface,
          memory_scope=excluded.memory_scope,
          tool_scope_json=excluded.tool_scope_json,
          permissions_json=excluded.permissions_json,
          default_channel=excluded.default_channel,
          extra_config_json=excluded.extra_config_json,
          updated_at=datetime('now')`,
      ).run(
        agent.slug,
        agent.name,
        agent.profile,
        agent.surface,
        agent.memory_scope,
        JSON.stringify(agent.tool_scope),
        JSON.stringify(agent.permissions),
        agent.default_channel,
        JSON.stringify(agent.extra_config ?? {}),
      )
    }
  }

  getById(id: number): AgentInstance | undefined {
    const db = this.getDb()
    return db.prepare('SELECT * FROM agent_instances WHERE id = ?').get(id) as AgentInstance | undefined
  }

  getBySlug(slug: string): AgentInstance | undefined {
    const db = this.getDb()
    return db.prepare('SELECT * FROM agent_instances WHERE slug = ?').get(slug) as AgentInstance | undefined
  }

  getDefaultForSurface(surface: AgentSurface = 'chat'): AgentInstance {
    const db = this.getDb()
    const agent = db.prepare(
      `SELECT * FROM agent_instances WHERE surface = ? AND status = 'active' ORDER BY id ASC LIMIT 1`,
    ).get(surface) as AgentInstance | undefined

    if (agent) return agent

    this.ensureDefaults()

    const seeded = db.prepare(
      `SELECT * FROM agent_instances WHERE surface = ? AND status = 'active' ORDER BY id ASC LIMIT 1`,
    ).get(surface) as AgentInstance | undefined

    if (!seeded) {
      throw new Error(`No active agent instance available for surface: ${surface}`)
    }

    return seeded
  }

  listActive(): AgentInstance[] {
    const db = this.getDb()
    return db.prepare(
      `SELECT * FROM agent_instances WHERE status = 'active' ORDER BY surface ASC, id ASC`,
    ).all() as AgentInstance[]
  }
}

export const agentInstanceService = new AgentInstanceService()
