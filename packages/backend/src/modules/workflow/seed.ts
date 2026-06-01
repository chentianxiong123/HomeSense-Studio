import { getDb as defaultGetDb } from '../../db/index.js'
import { computeWorkflowGraphHash } from './graph-version.js'

type GetDbFn = () => ReturnType<typeof defaultGetDb>

interface SeedWorkflowNodeInput {
  type: string
  label: string
  position: { x: number; y: number }
  config?: Record<string, unknown>
}

interface SeedWorkflowEdgeInput {
  sourceIndex: number
  targetIndex: number
  source_port?: string
  target_port?: string
  condition?: Record<string, unknown>
}

interface SeedWorkflowInput {
  name: string
  description: string
  trigger_type?: 'manual' | 'cron' | 'chat'
  published?: boolean
  nodes: SeedWorkflowNodeInput[]
  edges: SeedWorkflowEdgeInput[]
}

interface SeedSyncOptions {
  overwrite?: boolean
}

export interface SeedSyncResult {
  created: string[]
  updated: string[]
  skipped: string[]
}

const DEFAULT_WORKFLOW_SEEDS: SeedWorkflowInput[] = [
  {
    name: 'Device Capability Rehearsal Demo',
    description: 'Recommended smart-home workflow: run a structured device capability through the shared device-agent runtime, with sandbox rehearsal before real execution.',
    trigger_type: 'manual',
    published: true,
    nodes: [
      {
        type: 'start',
        label: 'Start',
        position: { x: 80, y: 120 },
        config: {
          inputs: {
            device_id: 1,
            capability_id: 'mi.ir_key',
            key: 'BACK',
          },
        },
      },
      {
        type: 'device_capability',
        label: 'Rehearse And Execute',
        position: { x: 390, y: 120 },
        config: {
          device_id: '{{input.device_id}}',
          capability_id: '{{input.capability_id}}',
          arguments: {
            key: '{{input.key}}',
          },
        },
      },
      {
        type: 'answer',
        label: 'Answer',
        position: { x: 720, y: 120 },
        config: {
          message: 'Device capability demo finished. Review the rehearsal and execution result on the device capability node.',
        },
      },
    ],
    edges: [
      { sourceIndex: 0, targetIndex: 1 },
      { sourceIndex: 1, targetIndex: 2 },
    ],
  },
  {
    name: 'Bilibili CLI Demo',
    description: 'Demo productivity workflow: search the real Bilibili CLI bridge and surface structured results.',
    trigger_type: 'manual',
    published: true,
    nodes: [
      {
        type: 'start',
        label: 'Start',
        position: { x: 80, y: 260 },
        config: {
          inputs: {
            query: 'HomeSense Studio',
          },
        },
      },
      {
        type: 'executor_call',
        label: 'Search Bilibili',
        position: { x: 360, y: 260 },
        config: {
          executor_name: 'cli.invoke',
          params: {
            cli_name: 'bilibili-cli',
            action: 'search',
            params: {
              query: '{{input.query}}',
              type: 'video',
              max: 3,
            },
          },
        },
      },
      {
        type: 'answer',
        label: 'Answer',
        position: { x: 660, y: 260 },
        config: {
          message: 'Bilibili CLI search completed. Review node.result for the structured response.',
        },
      },
    ],
    edges: [
      { sourceIndex: 0, targetIndex: 1 },
      { sourceIndex: 1, targetIndex: 2 },
    ],
  },
  {
    name: 'DLNA Cast Demo',
    description: 'Studio workflow skeleton: call the DLNA casting capability surface backed by the external bilibili-music project.',
    trigger_type: 'manual',
    published: false,
    nodes: [
      {
        type: 'start',
        label: 'Start',
        position: { x: 80, y: 330 },
        config: {
          inputs: {
            base_url: 'http://127.0.0.1:28974',
            target_ip: '',
          },
        },
      },
      {
        type: 'executor_call',
        label: 'Check DLNA Adapter',
        position: { x: 380, y: 300 },
        config: {
          executor_name: 'cli.invoke',
          params: {
            cli_name: 'dlna-cast-cli',
            action: 'health',
            params: {
              base_url: '{{input.base_url}}',
            },
          },
        },
      },
      {
        type: 'executor_call',
        label: 'Discover DLNA Devices',
        position: { x: 700, y: 300 },
        config: {
          executor_name: 'cli.invoke',
          params: {
            cli_name: 'dlna-cast-cli',
            action: 'discover_devices',
            params: {
              base_url: '{{input.base_url}}',
              target_ip: '{{input.target_ip}}',
            },
          },
        },
      },
      {
        type: 'answer',
        label: 'Answer',
        position: { x: 1020, y: 300 },
        config: {
          message: 'DLNA cast path checked. Use dlna-cast-cli.start_cast after a real device_udn and playable episode_url are selected.',
        },
      },
    ],
    edges: [
      { sourceIndex: 0, targetIndex: 1 },
      { sourceIndex: 1, targetIndex: 2 },
      { sourceIndex: 2, targetIndex: 3 },
    ],
  },
  {
    name: 'Speaker Cast Demo',
    description: 'Studio workflow skeleton: call the speaker casting capability surface backed by the external bilibili-music project.',
    trigger_type: 'manual',
    published: false,
    nodes: [
      {
        type: 'start',
        label: 'Start',
        position: { x: 80, y: 440 },
        config: {
          inputs: {
            base_url: 'http://127.0.0.1:28974',
          },
        },
      },
      {
        type: 'executor_call',
        label: 'Check Speaker Adapter',
        position: { x: 380, y: 440 },
        config: {
          executor_name: 'cli.invoke',
          params: {
            cli_name: 'speaker-cast-cli',
            action: 'health',
            params: {
              base_url: '{{input.base_url}}',
            },
          },
        },
      },
      {
        type: 'executor_call',
        label: 'List Speakers',
        position: { x: 700, y: 440 },
        config: {
          executor_name: 'cli.invoke',
          params: {
            cli_name: 'speaker-cast-cli',
            action: 'list_speakers',
            params: {
              base_url: '{{input.base_url}}',
            },
          },
        },
      },
      {
        type: 'answer',
        label: 'Answer',
        position: { x: 1020, y: 440 },
        config: {
          message: 'Speaker cast path checked. Use speaker-cast-cli.play_bilibili after a real speaker did and bvid are selected.',
        },
      },
    ],
    edges: [
      { sourceIndex: 0, targetIndex: 1 },
      { sourceIndex: 1, targetIndex: 2 },
      { sourceIndex: 2, targetIndex: 3 },
    ],
  },
  {
    name: 'Bilibili Media Dispatch Demo',
    description: 'Demo local capability workflow: dispatch a Bilibili search task through the registered CLI adapter and keep the result visible in trace.',
    trigger_type: 'manual',
    published: true,
    nodes: [
      {
        type: 'start',
        label: 'Start',
        position: { x: 80, y: 400 },
        config: {
          inputs: {
            query: 'HomeSense Studio',
          },
        },
      },
      {
        type: 'executor_call',
        label: 'Dispatch Bilibili Adapter',
        position: { x: 380, y: 400 },
        config: {
          executor_name: 'agent.dispatch',
          params: {
            target: 'bilibili_cli',
            task: 'Search Bilibili for HomeSense Studio demo videos.',
            payload: {
              action: 'search',
              query: '{{input.query}}',
              type: 'video',
              max: 3,
            },
            execution_mode: 'deferred',
          },
        },
      },
      {
        type: 'answer',
        label: 'Answer',
        position: { x: 700, y: 400 },
        config: {
          message: 'Bilibili media dispatch demo executed through the local adapter binding. Review node.result.adapter_result for the structured CLI output.',
        },
      },
    ],
    edges: [
      { sourceIndex: 0, targetIndex: 1 },
      { sourceIndex: 1, targetIndex: 2 },
    ],
  },
  {
    name: 'Bilibili Subflow Demo',
    description: 'Demo child-engine workflow: call the Bilibili media dispatch workflow as a reusable subflow.',
    trigger_type: 'manual',
    published: true,
    nodes: [
      {
        type: 'start',
        label: 'Start',
        position: { x: 80, y: 540 },
        config: {
          inputs: {
            query: 'HomeSense Studio',
          },
        },
      },
      {
        type: 'subflow',
        label: 'Run Bilibili Media Flow',
        position: { x: 380, y: 540 },
        config: {
          workflow_name: 'Bilibili Media Dispatch Demo',
          inputs: {
            query: '{{input.query}}',
          },
        },
      },
      {
        type: 'answer',
        label: 'Answer',
        position: { x: 700, y: 540 },
        config: {
          message: 'Bilibili subflow demo executed through child workflow runtime. Review node.subflow for nested execution details.',
        },
      },
    ],
    edges: [
      { sourceIndex: 0, targetIndex: 1 },
      { sourceIndex: 1, targetIndex: 2 },
    ],
  },
  {
    name: 'Watch Bilibili On Toshiba TV Demo',
    description: 'Target demo flow: resolve a family entertainment intent into Toshiba TV + STB IR control, ADB discovery, package verification, Bilibili TV launch, and a completion notification.',
    trigger_type: 'manual',
    published: true,
    nodes: [
      {
        type: 'start',
        label: 'Intent',
        position: { x: 80, y: 700 },
        config: {
          inputs: {
            intent: 'watch bilibili on the Toshiba TV',
            target_tv: 'tvs_toshiba',
            set_top_box: 'stb',
            media_app: 'bilibili_tv',
            app_package: 'com.xiaodianshi.tv.yst',
            power_scene: '东芝电视开机',
            xiaoai_directive: '打开东芝电视和机顶盒',
          },
        },
      },
      {
        type: 'code',
        label: 'Resolve Home Context',
        position: { x: 340, y: 700 },
        config: {
          inputs: {},
          code: [
            'return {',
            '  intent: variables["input.intent"],',
            '  target_tv: variables["input.target_tv"],',
            '  set_top_box: variables["input.set_top_box"],',
            '  media_app: variables["input.media_app"],',
            '  app_package: variables["input.app_package"],',
            '  route: [',
            '    "mi-cli.scene_execute:power_scene",',
            '    "mi-cli.speaker_execute:xiaoai_directive",',
            '    "adb.ensure_connected",',
            '    "adb.list_packages",',
            '    "adb.launch_app:com.xiaodianshi.tv.yst",',
            '    "channel.feishu.send"',
            '  ]',
            '}',
          ].join('\n'),
        },
      },
      {
        type: 'scene_execute',
        label: 'Run Power Scene',
        position: { x: 620, y: 620 },
        config: {
          scene_name: '{{input.power_scene}}',
        },
      },
      {
        type: 'xiaoai',
        label: 'Ask XiaoAi Hub',
        position: { x: 620, y: 780 },
        config: {
          mode: 'execute',
          text: '{{input.xiaoai_directive}}',
          silent: true,
        },
      },
      {
        type: 'executor_call',
        label: 'Ensure ADB Connected',
        position: { x: 900, y: 700 },
        config: {
          executor_name: 'agent.dispatch',
          params: {
            target: 'mi_adb',
            task: 'Ensure the Android TV ADB runtime is connected before launching the media app.',
            payload: {
              action: 'ensure_connected',
              initial_wait_seconds: 0,
              max_attempts: 3,
              backoff_seconds: 1,
            },
            execution_mode: 'immediate',
          },
        },
      },
      {
        type: 'if_else',
        label: 'ADB Ready?',
        position: { x: 1180, y: 700 },
        config: {
          left: '{{seed.node.4.result.data.adapter_result.data.connected}}',
          operator: '==',
          right: true,
        },
      },
      {
        type: 'executor_call',
        label: 'Inspect TV Packages',
        position: { x: 1460, y: 700 },
        config: {
          executor_name: 'agent.dispatch',
          params: {
            target: 'mi_adb',
            task: 'List installed Android TV packages and confirm the Bilibili TV package candidate.',
            payload: {
              action: 'list_packages',
            },
            execution_mode: 'immediate',
          },
        },
      },
      {
        type: 'if_else',
        label: 'Package Installed?',
        position: { x: 1740, y: 700 },
        config: {
          left: '{{seed.node.6.result.data.adapter_result.data.packages}}',
          operator: 'contains',
          right: '{{input.app_package}}',
        },
      },
      {
        type: 'executor_call',
        label: 'Launch Bilibili TV',
        position: { x: 2020, y: 700 },
        config: {
          executor_name: 'agent.dispatch',
          params: {
            target: 'mi_adb',
            task: 'Launch the Bilibili TV app on the Toshiba TV path.',
            payload: {
              action: 'launch_app',
              package: '{{input.app_package}}',
            },
            execution_mode: 'immediate',
          },
        },
      },
      {
        type: 'executor_call',
        label: 'Notify via Feishu',
        position: { x: 2300, y: 700 },
        config: {
          executor_name: 'service.invoke',
          params: {
            service_name: 'channel.feishu.send',
            params: {
              text: 'HomeSense demo ready: Toshiba TV Bilibili launched for intent={{input.intent}}',
              msg_type: 'text',
            },
          },
        },
      },
      {
        type: 'answer',
        label: 'Success Answer',
        position: { x: 2580, y: 700 },
        config: {
          message: 'Toshiba TV Bilibili path completed. Verified {{seed.node.6.result.data.adapter_result.data.packages.length}} candidate package(s), launched {{input.app_package}}, and sent the completion notification.',
        },
      },
      {
        type: 'answer',
        label: 'ADB Fallback',
        position: { x: 1460, y: 860 },
        config: {
          message: 'ADB fallback: the entertainment route stopped before package inspection because the Android TV runtime did not confirm a live connection.',
        },
      },
      {
        type: 'answer',
        label: 'Package Missing Fallback',
        position: { x: 2020, y: 860 },
        config: {
          message: 'Package fallback: {{input.app_package}} was not found on the TV runtime. Observed packages: {{seed.node.6.result.data.adapter_result.data.packages}}.',
        },
      },
    ],
    edges: [
      { sourceIndex: 0, targetIndex: 1 },
      { sourceIndex: 1, targetIndex: 2 },
      { sourceIndex: 1, targetIndex: 3 },
      { sourceIndex: 2, targetIndex: 4 },
      { sourceIndex: 3, targetIndex: 4 },
      { sourceIndex: 4, targetIndex: 5 },
      { sourceIndex: 5, targetIndex: 6, source_port: 'true' },
      { sourceIndex: 5, targetIndex: 11, source_port: 'false' },
      { sourceIndex: 6, targetIndex: 7 },
      { sourceIndex: 7, targetIndex: 8, source_port: 'true' },
      { sourceIndex: 7, targetIndex: 12, source_port: 'false' },
      { sourceIndex: 8, targetIndex: 9 },
      { sourceIndex: 9, targetIndex: 10 },
    ],
  },
  {
    name: 'Candidate Plan Routing Demo',
    description: 'Demo shared-infra workflow: retrieve semantic knowledge, rerank the hit set, resolve candidate plans, and summarize the best route without reusing Chat L1/L2/L3 runtime logic.',
    trigger_type: 'manual',
    published: true,
    nodes: [
      {
        type: 'start',
        label: 'Start',
        position: { x: 80, y: 980 },
        config: {
          inputs: {
            query: 'run the bilibili workflow',
          },
        },
      },
      {
        type: 'knowledge_retrieve',
        label: 'Semantic Knowledge',
        position: { x: 360, y: 900 },
        config: {
          query: '{{input.query}}',
          source: 'semantic',
          limit: 5,
        },
      },
      {
        type: 'code',
        label: 'Build Rerank Documents',
        position: { x: 650, y: 900 },
        config: {
          inputs: {
            hits: '{{seed.node.1.hits}}',
          },
          code: [
            'const hits = Array.isArray(inputs.hits) ? inputs.hits : [];',
            'return {',
            '  documents: hits.map((hit) => ({',
            '    id: hit.id,',
            '    text: hit.content,',
            '    base_score: hit.score,',
            '    metadata: { type: hit.type, source: hit.source }',
            '  }))',
            '};',
          ].join('\n'),
        },
      },
      {
        type: 'rerank_score',
        label: 'Rerank Knowledge',
        position: { x: 940, y: 900 },
        config: {
          query: '{{input.query}}',
          documents: '{{seed.node.2.documents}}',
        },
      },
      {
        type: 'candidate_plan_resolve',
        label: 'Resolve Candidate Plan',
        position: { x: 1230, y: 980 },
        config: {
          query: '{{input.query}}',
        },
      },
      {
        type: 'answer',
        label: 'Answer',
        position: { x: 1520, y: 980 },
        config: {
          message: 'Candidate plan demo: best kind={{seed.node.4.candidate_plan.candidate_kind}}, title={{seed.node.4.candidate_plan.title}}, semantic top={{seed.node.1.hits.0.type}}/{{seed.node.1.hits.0.source}}, rerank top score={{seed.node.3.ranked.0.score}}.',
        },
      },
    ],
    edges: [
      { sourceIndex: 0, targetIndex: 1 },
      { sourceIndex: 1, targetIndex: 2 },
      { sourceIndex: 2, targetIndex: 3 },
      { sourceIndex: 3, targetIndex: 4 },
      { sourceIndex: 4, targetIndex: 5 },
    ],
  },
]

class WorkflowSeedService {
  constructor(private readonly getDb: GetDbFn = defaultGetDb) {}

  ensureDefaults(): SeedSyncResult {
    return this.syncDefaults()
  }

  syncDefaults(options: SeedSyncOptions = {}): SeedSyncResult {
    const db = this.getDb()
    const result: SeedSyncResult = { created: [], updated: [], skipped: [] }

    for (const seed of DEFAULT_WORKFLOW_SEEDS) {
      const existing = db.prepare(
        'SELECT id FROM workflows WHERE name = ? LIMIT 1',
      ).get(seed.name) as { id: number } | undefined

      if (existing && !options.overwrite) {
        result.skipped.push(seed.name)
        continue
      }

      if (existing) {
        this.replaceWorkflowSeed(existing.id, seed)
        result.updated.push(seed.name)
        continue
      }

      this.insertWorkflowSeed(seed)
      result.created.push(seed.name)
    }

    return result
  }

  private insertWorkflowSeed(seed: SeedWorkflowInput): number {
    const db = this.getDb()
    const workflowResult = db.prepare(
      `INSERT INTO workflows (name, description, trigger_type, cron_expression, published, graph_json)
       VALUES (?, ?, ?, NULL, ?, ?)`,
    ).run(
      seed.name,
      seed.description,
      seed.trigger_type ?? 'manual',
      seed.published ? 1 : 0,
      JSON.stringify({ nodes: seed.nodes, edges: seed.edges }),
    )

    const workflowId = Number(workflowResult.lastInsertRowid)
    this.writeSeedGraph(workflowId, seed)
    return workflowId
  }

  private replaceWorkflowSeed(workflowId: number, seed: SeedWorkflowInput): void {
    const db = this.getDb()
    db.prepare(
      `UPDATE workflows
       SET description = ?, trigger_type = ?, published = ?, graph_json = ?, graph_hash = ?, updated_at = datetime('now'), graph_updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      seed.description,
      seed.trigger_type ?? 'manual',
      seed.published ? 1 : 0,
      seedGraphJson(seed),
      computeWorkflowGraphHash(seedGraphJson(seed)),
      workflowId,
    )

    db.prepare('DELETE FROM workflow_edges WHERE workflow_id = ?').run(workflowId)
    db.prepare('DELETE FROM workflow_nodes WHERE workflow_id = ?').run(workflowId)
    this.writeSeedGraph(workflowId, seed)
  }

  private writeSeedGraph(workflowId: number, seed: SeedWorkflowInput): void {
    const db = this.getDb()
    const insertedNodeIds: number[] = []
    const insertNode = db.prepare(
      `INSERT INTO workflow_nodes (workflow_id, type, label, position_json, config_json)
       VALUES (?, ?, ?, ?, ?)`,
    )

    for (const node of seed.nodes) {
      const nodeResult = insertNode.run(
        workflowId,
        node.type,
        node.label,
        JSON.stringify(node.position),
        JSON.stringify(node.config ?? {}),
      )
      insertedNodeIds.push(Number(nodeResult.lastInsertRowid))
    }

    const updateNodeConfig = db.prepare('UPDATE workflow_nodes SET config_json = ? WHERE id = ?')
    const resolvedNodes = seed.nodes.map((node, index) => {
      const resolvedConfig = this.resolveSeedRefs(node.config ?? {}, insertedNodeIds)
      updateNodeConfig.run(JSON.stringify(resolvedConfig), insertedNodeIds[index])
      return {
        ...node,
        config: resolvedConfig,
      }
    })

    const insertEdge = db.prepare(
      `INSERT INTO workflow_edges (workflow_id, source_node_id, target_node_id, source_port, target_port, condition_json)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )

    for (const edge of seed.edges) {
      insertEdge.run(
        workflowId,
        insertedNodeIds[edge.sourceIndex],
        insertedNodeIds[edge.targetIndex],
        edge.source_port ?? 'out',
        edge.target_port ?? 'in',
        JSON.stringify(edge.condition ?? {}),
      )
    }

    const resolvedEdges = seed.edges.map((edge) => ({
      source_node_id: insertedNodeIds[edge.sourceIndex],
      target_node_id: insertedNodeIds[edge.targetIndex],
      source_port: edge.source_port ?? 'out',
      target_port: edge.target_port ?? 'in',
      condition: edge.condition ?? {},
    }))

    const graphJson = JSON.stringify({ nodes: resolvedNodes, edges: resolvedEdges })
    db.prepare('UPDATE workflows SET graph_json = ?, graph_hash = ?, updated_at = datetime(\'now\'), graph_updated_at = datetime(\'now\') WHERE id = ?').run(
      graphJson,
      computeWorkflowGraphHash(graphJson),
      workflowId,
    )
  }

  private resolveSeedRefs(value: unknown, insertedNodeIds: number[]): unknown {
    if (typeof value === 'string') {
      return value.replace(/seed\.node\.(\d+)/g, (_, rawIndex: string) => {
        const index = Number(rawIndex)
        return Number.isInteger(index) && insertedNodeIds[index] != null
          ? `node.${insertedNodeIds[index]}`
          : `seed.node.${rawIndex}`
      })
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveSeedRefs(item, insertedNodeIds))
    }

    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, child]) => [
          key,
          this.resolveSeedRefs(child, insertedNodeIds),
        ]),
      )
    }

    return value
  }
}

export const workflowSeedService = new WorkflowSeedService()

function seedGraphJson(seed: SeedWorkflowInput): string {
  return JSON.stringify({ nodes: seed.nodes, edges: seed.edges })
}
