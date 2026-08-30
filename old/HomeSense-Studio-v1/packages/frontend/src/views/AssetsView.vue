<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { deviceSkillApi } from '@/api/deviceSkills'
import { memoryAssetsApi, type MemoryAssetRecord, type MemoryAssetSummary } from '@/api/memoryAssets'
import { runtimeCapabilityApi, type RuntimeCapabilityMap, type RuntimeCapabilitySurface } from '@/api/runtimeCapabilities'
import { skillApi } from '@/api/skills'
import { useLocale } from '@/composables/useLocale'

type AssetDomainKey = 'runtime_capability' | 'device_skill' | 'memory' | 'skill' | 'mcp_skill' | 'gateway'

type AssetDomain = {
  key: AssetDomainKey
  title: string
  subtitle: string
  status: string
  count: number | null
  accent: string
  role: string
  llmUsage: string
  nextStep: string
}

type MemorySubtype = {
  key: string
  title: string
  status: string
  count: number | null
  source: string
  description: string
  retrieval: string
}

const { locale } = useLocale()

const loading = ref(false)
const errorMessage = ref('')
const selectedDomainKey = ref<AssetDomainKey>('device_skill')
const lastLoadedAt = ref('')
const counts = ref({
  runtimeCapabilities: 0,
  deviceSkills: 0,
  skills: 0,
  memory: 0,
})
const memoryAssets = ref<MemoryAssetRecord[]>([])
const memorySummary = ref<MemoryAssetSummary | null>(null)
const runtimeCapabilityMap = ref<RuntimeCapabilityMap | null>(null)

const isZh = computed(() => locale.value === 'zh')
const totalActiveAssets = computed(() =>
  counts.value.runtimeCapabilities
  + counts.value.deviceSkills
  + counts.value.skills
  + counts.value.memory,
)

const domains = computed<AssetDomain[]>(() => [
  {
    key: 'runtime_capability',
    title: label('能力地图', 'Capability Map'),
    subtitle: label('底层能力统一入口', 'Unified runtime surface'),
    status: label('已汇聚', 'Mapped'),
    count: counts.value.runtimeCapabilities,
    accent: '#0f766e',
    role: label('把设备能力、CLI/服务、模型供应商、Workflow 节点和 Skill 汇成一张运行时能力地图。', 'Aggregates device capabilities, CLI/services, model providers, workflow nodes, and skills into one runtime map.'),
    llmUsage: label('LLM 和 Studio 先看这张轻量索引，再按需展开真实设备、CLI action 或 skill。', 'The LLM and Studio first see this lightweight index, then expand real devices, CLI actions, or skills as needed.'),
    nextStep: label('把这张能力地图接进 Workflow 节点选择和 Chat 工具选择。', 'Use this map for Workflow node selection and Chat tool selection.'),
  },
  {
    key: 'device_skill',
    title: label('设备技能', 'Device Skills'),
    subtitle: label('设备类型说明书', 'Device-type playbooks'),
    status: label('已接入', 'Active'),
    count: counts.value.deviceSkills,
    accent: '#0f9f6e',
    role: label('按电视、机顶盒、音箱、手机、电脑等设备类型组织能力说明。', 'Organizes capability instructions by device type.'),
    llmUsage: label('LLM 先看到设备列表和上下文设备，需要时再加载对应设备类型的 skill。', 'The LLM sees devices first, then loads the matching device skill when needed.'),
    nextStep: label('继续把真实设备能力 JSON 接进 skill 详情。', 'Connect real capability JSON into skill details.'),
  },
  {
    key: 'memory',
    title: label('记忆', 'Memory'),
    subtitle: label('经验路径 / 反馈 / 长期上下文', 'Experience paths / feedback / long-term context'),
    status: label('整理中', 'Shaping'),
    count: counts.value.memory,
    accent: '#2563eb',
    role: label('记忆是总入口，下面可以有经验路径、用户反馈、设备偏好、空间地图和长期知识。路径负责记录成功链路，skill 负责说明怎么做。', 'Memory is the top-level entry for experience paths, feedback, preferences, spatial maps, and long-term knowledge. Paths record proven routes; skills explain how to act.'),
    llmUsage: label('运行时只加载必要的记忆摘要；经验路径可引用设备 skill 或通用 skill，但不重复整份说明书。', 'Runtime loads only necessary memory summaries; experience paths can reference device or general skills without duplicating the full instructions.'),
    nextStep: label('先把旧 manifest / plan 收敛成“记忆 / 经验路径”，并保留它引用 skill 的接口。', 'Fold old manifests and plans into Memory / Experience Path while keeping explicit skill references.'),
  },
  {
    key: 'skill',
    title: label('通用技能', 'General Skills'),
    subtitle: label('可复用说明书', 'Reusable instructions'),
    status: label('已接入', 'Active'),
    count: counts.value.skills,
    accent: '#7c3aed',
    role: label('承接不强绑定设备类型的工具用法、上下文策略和任务模板。', 'Holds tool instructions, context policy, and task templates not bound to one device type.'),
    llmUsage: label('只有任务需要时才渐进式加载，避免一开始塞满上下文。', 'Loaded progressively only when needed to avoid filling the context upfront.'),
    nextStep: label('统一 md skill 的索引、摘要、加载条件和示例。', 'Unify md skill index, summaries, load triggers, and examples.'),
  },
  {
    key: 'mcp_skill',
    title: label('MCP Skills', 'MCP Skills'),
    subtitle: label('未来外部工具技能', 'Future external tool skills'),
    status: label('规划中', 'Planned'),
    count: null,
    accent: '#d97706',
    role: label('未来承接 MCP 工具的说明、参数、示例和加载规则。', 'Future home for MCP tool instructions, arguments, examples, and loading rules.'),
    llmUsage: label('等 MCP 接入后，LLM 通过 skill 而不是裸工具列表理解怎么用。', 'After MCP lands, the LLM learns usage through skills instead of raw tool lists.'),
    nextStep: label('先不实现后端，只保留资产入口。', 'Keep the entry point; no backend work yet.'),
  },
  {
    key: 'gateway',
    title: label('消息网关', 'Message Gateways'),
    subtitle: label('手机 / 电视 / 通知通道', 'Mobile / TV / notification channels'),
    status: label('规划中', 'Planned'),
    count: null,
    accent: '#dc2626',
    role: label('未来承接消息、远程控制、电视和手机应用交互通道。', 'Future home for messaging, remote control, TV, and mobile app channels.'),
    llmUsage: label('LLM 只看到可用通道摘要，具体协议由网关资产隐藏。', 'The LLM sees channel summaries while gateway assets hide protocol details.'),
    nextStep: label('等运行时链路稳定后再接。', 'Connect after the runtime chain stabilizes.'),
  },
])

const selectedDomain = computed(() =>
  domains.value.find((domain) => domain.key === selectedDomainKey.value) ?? domains.value[0],
)

const visibleMemoryAssets = computed(() =>
  memoryAssets.value
    .filter((asset) => asset.source !== 'placeholder')
    .slice(0, 12),
)

const visibleCapabilitySurfaces = computed(() =>
  (runtimeCapabilityMap.value?.surfaces ?? [])
    .filter((surface) => surface.configured || surface.domain === 'provider' || surface.domain === 'workflow_node')
    .slice(0, 18),
)

const memorySubtypes = computed<MemorySubtype[]>(() => [
  {
    key: 'experience_path',
    title: label('经验路径', 'Experience Paths'),
    status: label('迁移中', 'Migrating'),
    count: memorySummary.value?.by_kind.experience_path ?? 0,
    source: label('旧来源迁移', 'Legacy migration'),
    description: label('一次成功任务后固化下来的步骤、参数、适用条件，以及它依赖的 skill。', 'Steps, arguments, conditions, and referenced skills captured after a successful task.'),
    retrieval: label('快速召回路径；命中后交给 LLM 校验，再按引用的 skill 展开具体做法。', 'Recall the path quickly; the LLM validates it and expands referenced skills when needed.'),
  },
  {
    key: 'feedback',
    title: label('用户反馈', 'User Feedback'),
    status: label('规划中', 'Planned'),
    count: memorySummary.value?.by_kind.user_feedback ?? null,
    source: label('对话修正', 'Conversation corrections'),
    description: label('用户说“不对”“以后这样做”“这个设备不是这个房间”等修正。', 'Corrections such as “not that”, “do this next time”, or room/device fixes.'),
    retrieval: label('优先影响同类任务的策略和默认选择。', 'Biases strategy and defaults for similar future tasks.'),
  },
  {
    key: 'device_preference',
    title: label('设备偏好', 'Device Preferences'),
    status: label('规划中', 'Planned'),
    count: memorySummary.value?.by_kind.device_preference ?? null,
    source: label('设备上下文', 'Device context'),
    description: label('默认电视、常用音箱、常用 App、房间偏好和用户习惯。', 'Default TVs, speakers, apps, room preferences, and habits.'),
    retrieval: label('作为运行时必带上下文的补充，不全量塞进提示词。', 'Complements required runtime context without stuffing the prompt.'),
  },
  {
    key: 'spatial_map',
    title: label('空间地图', 'Spatial Map'),
    status: label('规划中', 'Planned'),
    count: memorySummary.value?.by_kind.spatial_map ?? null,
    source: label('房间 / 设备 / 位置', 'Rooms / devices / locations'),
    description: label('未来承接记忆宫殿、轻量图结构、设备所在房间和关系。', 'Future home for memory palace ideas, lightweight graph structure, rooms, and relations.'),
    retrieval: label('用于理解“这里”“客厅那个”“电视旁边”的上下文。', 'Helps resolve context like “here”, “the living room one”, or “beside the TV”.'),
  },
  {
    key: 'long_term_knowledge',
    title: label('长期知识', 'Long-Term Knowledge'),
    status: label('后置', 'Later'),
    count: memorySummary.value?.by_kind.long_term_knowledge ?? null,
    source: label('RAG / 向量 / 文档', 'RAG / vectors / docs'),
    description: label('独立外挂的知识与文档记忆，未来再接向量、重排序和 SQLite。', 'External knowledge memory, later backed by vectors, rerank, and SQLite.'),
    retrieval: label('只在需要解释、查资料或补全知识时召回。', 'Retrieved only for explanation, lookup, or knowledge completion.'),
  },
])

onMounted(loadAssets)

async function loadAssets() {
  loading.value = true
  errorMessage.value = ''
  try {
    const [deviceSkills, skills, memoryResult, capabilityResult] = await Promise.all([
      deviceSkillApi.list(),
      skillApi.list(),
      memoryAssetsApi.list(),
      runtimeCapabilityApi.get(),
    ])

    counts.value = {
      runtimeCapabilities: capabilityResult.map?.summary.total_surfaces ?? capabilityResult.map?.surfaces.length ?? 0,
      deviceSkills: deviceSkills.skills?.length ?? 0,
      skills: skills.skills?.length ?? 0,
      memory: memoryResult.summary?.total ?? memoryResult.assets?.length ?? 0,
    }
    memoryAssets.value = memoryResult.assets ?? []
    memorySummary.value = memoryResult.summary
    runtimeCapabilityMap.value = capabilityResult.map ?? null
    lastLoadedAt.value = formatChinaTime(new Date())
  } catch (error) {
    errorMessage.value = (error as Error).message || label('资产加载失败。', 'Failed to load assets.')
  } finally {
    loading.value = false
  }
}

function selectDomain(key: AssetDomainKey) {
  selectedDomainKey.value = key
}

function label(zh: string, en: string) {
  return isZh.value ? zh : en
}

function formatMemoryKind(kind: MemoryAssetRecord['kind']) {
  const labels: Record<MemoryAssetRecord['kind'], [string, string]> = {
    experience_path: ['经验路径', 'Experience Path'],
    user_feedback: ['用户反馈', 'User Feedback'],
    device_preference: ['设备偏好', 'Device Preference'],
    spatial_map: ['空间地图', 'Spatial Map'],
    long_term_knowledge: ['长期知识', 'Long-Term Knowledge'],
  }
  const item = labels[kind]
  return label(item[0], item[1])
}

function formatMemorySource(source: MemoryAssetRecord['source']) {
  const labels: Record<MemoryAssetRecord['source'], [string, string]> = {
    manifest: ['旧执行入口', 'Legacy Manifest'],
    plan: ['旧计划', 'Legacy Plan'],
    runtime: ['运行时沉淀', 'Runtime'],
    user: ['用户固化', 'User'],
    imported: ['导入', 'Imported'],
    system: ['系统', 'System'],
    placeholder: ['规划占位', 'Planned'],
  }
  const item = labels[source]
  return label(item[0], item[1])
}

function formatMemoryStatus(status: MemoryAssetRecord['status']) {
  const labels: Record<MemoryAssetRecord['status'], [string, string]> = {
    active: ['可用', 'Active'],
    planned: ['规划中', 'Planned'],
    legacy: ['迁移项', 'Legacy'],
  }
  const item = labels[status]
  return label(item[0], item[1])
}

function formatExperienceStats(asset: MemoryAssetRecord) {
  if (asset.kind !== 'experience_path') return ''
  const successCount = readMetadataNumber(asset.metadata.success_count)
  const failureCount = readMetadataNumber(asset.metadata.failure_count)
  const parts = [
    label(`成功 ${successCount}`, `Success ${successCount}`),
    label(`失败 ${failureCount}`, `Failure ${failureCount}`),
  ]
  const inputKeys = formatWorkflowInputKeys(asset)
  if (inputKeys) parts.push(label(`输入 ${inputKeys}`, `Inputs ${inputKeys}`))
  return parts.join(label(' · ', ' · '))
}

function formatWorkflowInputKeys(asset: MemoryAssetRecord) {
  const inputs = asset.metadata.workflow_inputs
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) return ''
  const keys = Object.keys(inputs)
  if (keys.length === 0) return ''
  if (keys.length <= 3) return keys.join(', ')
  return `${keys.slice(0, 3).join(', ')} +${keys.length - 3}`
}

function formatCapabilityDomain(surface: RuntimeCapabilitySurface) {
  const labels: Record<RuntimeCapabilitySurface['domain'], [string, string]> = {
    device: ['设备', 'Device'],
    executor: ['执行器', 'Executor'],
    provider: ['模型', 'Provider'],
    workflow_node: ['节点', 'Node'],
    skill: ['Skill', 'Skill'],
  }
  const item = labels[surface.domain]
  return label(item[0], item[1])
}

function formatCapabilityStatus(surface: RuntimeCapabilitySurface) {
  const labels: Record<RuntimeCapabilitySurface['status'], [string, string]> = {
    ready: ['可用', 'Ready'],
    planned: ['规划', 'Planned'],
    disabled: ['停用', 'Disabled'],
    dry_run: ['演练', 'Dry Run'],
    offline: ['离线', 'Offline'],
    unknown: ['未知', 'Unknown'],
  }
  const item = labels[surface.status]
  return label(item[0], item[1])
}

function formatCapabilityActions(surface: RuntimeCapabilitySurface) {
  const names = surface.actions
    .slice(0, 4)
    .map((action) => action.name)
    .filter(Boolean)
  if (surface.actions.length > 4) names.push(`+${surface.actions.length - 4}`)
  return names.join(' / ') || label('无动作', 'No actions')
}

function formatCapabilityTags(surface: RuntimeCapabilitySurface) {
  return surface.tags.slice(0, 4).join(' / ')
}

function memoryAssetRoute(asset: MemoryAssetRecord) {
  return `/assets/memory/${encodeURIComponent(asset.id)}/overview`
}

function formatPathRelations(asset: MemoryAssetRecord) {
  const parts: string[] = []
  if (asset.skill_refs.length > 0) {
    parts.push(label('引用 skill：', 'Skills: ') + asset.skill_refs
      .map((ref) => ref.label || ref.id)
      .join(' / '))
  }
  if (asset.device_refs.length > 0) {
    parts.push(label('关联设备：', 'Devices: ') + asset.device_refs.join(' / '))
  }
  return parts.join(label('；', '; '))
}

function readMetadataNumber(value: unknown) {
  const number = Number(value ?? 0)
  return Number.isFinite(number) ? number : 0
}

function formatChinaTime(date: Date) {
  return date.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}
</script>

<template>
  <div class="assets-page">
    <section class="hero-band">
      <div>
        <span class="eyebrow">{{ label('资产', 'Assets') }}</span>
        <h1>{{ label('智能家居 Agent 的资产地图', 'Asset Map for the Smart Home Agent') }}</h1>
        <p>
          {{ label('这里不再堆内部表格，先保留真正会进入运行时链路的资产域：设备技能、记忆、通用技能、MCP Skills 和消息网关。', 'This page focuses on asset domains that will enter the runtime chain: device skills, memory, general skills, MCP skills, and gateways.') }}
        </p>
      </div>

      <div class="hero-metrics">
        <div>
          <span>{{ label('已接入资产', 'Active Assets') }}</span>
          <strong>{{ loading ? '-' : totalActiveAssets }}</strong>
        </div>
        <div>
          <span>{{ label('中国时间', 'China Time') }}</span>
          <strong>{{ lastLoadedAt || '-' }}</strong>
        </div>
        <button type="button" class="refresh-btn" :disabled="loading" @click="loadAssets">
          {{ loading ? label('刷新中', 'Refreshing') : label('刷新', 'Refresh') }}
        </button>
      </div>
    </section>

    <div v-if="errorMessage" class="error-line">{{ errorMessage }}</div>

    <section class="domain-grid">
      <button
        v-for="domain in domains"
        :key="domain.key"
        type="button"
        :class="['domain-card', { active: selectedDomainKey === domain.key, planned: domain.count === null }]"
        :style="{ '--accent': domain.accent }"
        @click="selectDomain(domain.key)"
      >
        <span class="domain-status">{{ domain.status }}</span>
        <strong>{{ domain.title }}</strong>
        <small>{{ domain.subtitle }}</small>
        <span class="domain-count">{{ domain.count === null ? label('待接入', 'Pending') : domain.count }}</span>
      </button>
    </section>

    <section class="domain-detail">
      <aside>
        <span class="eyebrow">{{ selectedDomain.status }}</span>
        <h2>{{ selectedDomain.title }}</h2>
        <p>{{ selectedDomain.subtitle }}</p>
      </aside>

      <main :class="{ 'memory-main': selectedDomainKey === 'memory', 'capability-main': selectedDomainKey === 'runtime_capability' }">
        <template v-if="selectedDomainKey === 'runtime_capability'">
          <div class="memory-brief">
            <article>
              <span>{{ label('定位', 'Role') }}</span>
              <p>{{ selectedDomain.role }}</p>
            </article>
            <article>
              <span>{{ label('LLM 如何使用', 'LLM Usage') }}</span>
              <p>{{ selectedDomain.llmUsage }}</p>
            </article>
            <article>
              <span>{{ label('下一步', 'Next') }}</span>
              <p>{{ selectedDomain.nextStep }}</p>
            </article>
          </div>

          <div class="capability-domain-strip">
            <article
              v-for="domain in runtimeCapabilityMap?.domains ?? []"
              :key="domain.domain"
              class="capability-domain-card"
            >
              <span>{{ domain.title }}</span>
              <strong>{{ domain.count }}</strong>
              <small>{{ label('动作', 'Actions') }} {{ domain.action_count }} · {{ label('已配置', 'Configured') }} {{ domain.configured }}</small>
            </article>
          </div>

          <div class="capability-surface-panel">
            <div class="memory-list-head">
              <div>
                <span>{{ label('运行时能力', 'Runtime Surfaces') }}</span>
                <h3>{{ label('真实注册表汇总', 'Real Registry Map') }}</h3>
              </div>
              <strong>{{ runtimeCapabilityMap?.summary.total_actions ?? 0 }}</strong>
            </div>

            <div v-if="visibleCapabilitySurfaces.length === 0" class="memory-empty">
              {{ label('还没有可展示的运行时能力。', 'No runtime capability surfaces yet.') }}
            </div>
            <div v-else class="capability-surface-grid">
              <article
                v-for="surface in visibleCapabilitySurfaces"
                :key="surface.id"
                class="capability-surface-card"
              >
                <div class="capability-surface-top">
                  <span>{{ formatCapabilityDomain(surface) }}</span>
                  <span>{{ formatCapabilityStatus(surface) }}</span>
                </div>
                <h4>{{ surface.title }}</h4>
                <p>{{ surface.description }}</p>
                <div class="capability-action-line">
                  <span>{{ label('动作', 'Actions') }}</span>
                  <p>{{ formatCapabilityActions(surface) }}</p>
                </div>
                <div v-if="formatCapabilityTags(surface)" class="capability-tag-line">
                  {{ formatCapabilityTags(surface) }}
                </div>
                <small>{{ surface.usage_hint }}</small>
              </article>
            </div>
          </div>
        </template>

        <template v-else-if="selectedDomainKey === 'memory'">
          <div class="memory-brief">
            <article>
              <span>{{ label('定位', 'Role') }}</span>
              <p>{{ selectedDomain.role }}</p>
            </article>
            <article>
              <span>{{ label('LLM 如何使用', 'LLM Usage') }}</span>
              <p>{{ selectedDomain.llmUsage }}</p>
            </article>
            <article>
              <span>{{ label('下一步', 'Next') }}</span>
              <p>{{ selectedDomain.nextStep }}</p>
            </article>
          </div>

          <div class="memory-subtypes">
            <article
              v-for="item in memorySubtypes"
              :key="item.key"
              class="memory-subtype-card"
            >
              <div class="memory-subtype-head">
                <span>{{ item.status }}</span>
                <strong>{{ item.count === null ? label('待接入', 'Pending') : item.count }}</strong>
              </div>
              <h3>{{ item.title }}</h3>
              <small>{{ item.source }}</small>
              <p>{{ item.description }}</p>
              <div class="retrieval-line">
                <span>{{ label('召回方式', 'Retrieval') }}</span>
                <p>{{ item.retrieval }}</p>
              </div>
            </article>
          </div>

          <div class="memory-list-panel">
            <div class="memory-list-head">
              <div>
                <span>{{ label('真实记忆项', 'Memory Items') }}</span>
                <h3>{{ label('已迁移的经验路径', 'Migrated Experience Paths') }}</h3>
              </div>
              <strong>{{ visibleMemoryAssets.length }}</strong>
            </div>

            <div v-if="visibleMemoryAssets.length === 0" class="memory-empty">
              {{ label('还没有可展示的真实记忆项。', 'No persisted memory items yet.') }}
            </div>
            <div v-else class="memory-item-list">
              <article
                v-for="asset in visibleMemoryAssets"
                :key="asset.id"
                class="memory-item"
              >
                <div class="memory-item-top">
                  <span>{{ formatMemoryKind(asset.kind) }}</span>
                  <span>{{ formatMemorySource(asset.source) }}</span>
                  <span>{{ formatMemoryStatus(asset.status) }}</span>
                </div>
                <div v-if="formatExperienceStats(asset)" class="memory-item-stats">
                  {{ formatExperienceStats(asset) }}
                </div>
                <div class="memory-title-row">
                  <h4>{{ asset.title }}</h4>
                  <RouterLink class="memory-detail-link" :to="memoryAssetRoute(asset)">
                    {{ label('详情', 'Detail') }}
                  </RouterLink>
                </div>
                <p>{{ asset.summary }}</p>
                <div v-if="asset.skill_refs.length > 0 || asset.device_refs.length > 0" class="memory-relations">
                  <span>{{ label('路径引用', 'Path Links') }}</span>
                  <p>{{ formatPathRelations(asset) }}</p>
                </div>
                <div class="memory-retrieval">
                  <span>{{ label('召回提示', 'Retrieval Hint') }}</span>
                  <p>{{ asset.retrieval_hint }}</p>
                </div>
              </article>
            </div>
          </div>
        </template>

        <template v-else>
          <article>
            <span>{{ label('定位', 'Role') }}</span>
            <p>{{ selectedDomain.role }}</p>
          </article>
          <article>
            <span>{{ label('LLM 如何使用', 'LLM Usage') }}</span>
            <p>{{ selectedDomain.llmUsage }}</p>
          </article>
          <article>
            <span>{{ label('下一步', 'Next') }}</span>
            <p>{{ selectedDomain.nextStep }}</p>
          </article>
        </template>
      </main>
    </section>
  </div>
</template>

<style scoped>
.assets-page {
  height: 100%;
  padding: 32px;
  overflow-y: auto;
  background: #f6f8fa;
  color: var(--text-primary);
}

.hero-band {
  min-height: 230px;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 360px;
  gap: 24px;
  padding: 32px;
  border: 1px solid rgba(203, 213, 225, 0.7);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.05);
}

.eyebrow {
  display: inline-flex;
  width: fit-content;
  margin-bottom: 16px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(15, 159, 110, 0.1);
  color: #047857;
  font-size: 12px;
  font-weight: 900;
}

h1,
h2,
p {
  margin: 0;
}

h1 {
  max-width: 760px;
  font-size: 34px;
  line-height: 1.15;
  font-weight: 900;
  letter-spacing: 0;
}

.hero-band p {
  max-width: 780px;
  margin-top: 18px;
  color: var(--text-secondary);
  font-size: 15px;
  line-height: 1.8;
  font-weight: 650;
}

.hero-metrics {
  display: grid;
  gap: 12px;
}

.hero-metrics > div,
.refresh-btn {
  min-height: 62px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 8px;
  background: #f8fafc;
}

.hero-metrics span {
  display: block;
  margin-bottom: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.hero-metrics strong {
  color: var(--text-primary);
  font-size: 22px;
  font-weight: 900;
}

.refresh-btn {
  cursor: pointer;
  color: #ffffff;
  background: #0f9f6e;
  border-color: #0f9f6e;
  font-size: 14px;
  font-weight: 900;
}

.refresh-btn:disabled {
  cursor: wait;
  opacity: 0.65;
}

.error-line {
  margin-top: 16px;
  padding: 12px 16px;
  border: 1px solid rgba(248, 113, 113, 0.35);
  border-radius: 8px;
  background: rgba(254, 242, 242, 0.8);
  color: #b91c1c;
  font-size: 13px;
  font-weight: 800;
}

.domain-grid {
  display: grid;
  grid-template-columns: repeat(6, minmax(0, 1fr));
  gap: 14px;
  margin-top: 20px;
}

.domain-card {
  min-height: 176px;
  padding: 18px;
  border: 1px solid rgba(203, 213, 225, 0.75);
  border-radius: 8px;
  background: #ffffff;
  text-align: left;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 10px;
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.domain-card:hover,
.domain-card.active {
  transform: translateY(-3px);
  border-color: var(--accent);
  box-shadow: 0 16px 36px rgba(15, 23, 42, 0.08);
}

.domain-card.planned {
  background: rgba(255, 255, 255, 0.62);
}

.domain-status {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  color: var(--accent);
  font-size: 12px;
  font-weight: 900;
}

.domain-card strong {
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 900;
  line-height: 1.25;
}

.domain-card small {
  flex: 1;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 750;
  line-height: 1.5;
}

.domain-count {
  color: var(--accent);
  font-size: 22px;
  font-weight: 950;
}

.domain-detail {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 20px;
  margin-top: 20px;
  padding: 28px;
  border: 1px solid rgba(203, 213, 225, 0.75);
  border-radius: 8px;
  background: #ffffff;
  box-shadow: 0 14px 40px rgba(15, 23, 42, 0.04);
}

.domain-detail h2 {
  font-size: 28px;
  font-weight: 900;
  line-height: 1.2;
  letter-spacing: 0;
}

.domain-detail aside p {
  margin-top: 12px;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 750;
}

.domain-detail main {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.domain-detail main.memory-main,
.domain-detail main.capability-main {
  grid-template-columns: 1fr;
}

.domain-detail article,
.memory-subtype-card {
  min-height: 150px;
  padding: 18px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 8px;
  background: #f8fafc;
}

.domain-detail article span,
.retrieval-line span {
  display: block;
  margin-bottom: 12px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.domain-detail article p,
.memory-subtype-card p {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 700;
  line-height: 1.7;
}

.memory-brief {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.memory-subtypes {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 14px;
}

.memory-subtype-card {
  min-height: 260px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  background: #ffffff;
}

.memory-subtype-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.memory-subtype-head span {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
}

.memory-subtype-head strong {
  color: #2563eb;
  font-size: 18px;
  font-weight: 950;
}

.memory-subtype-card h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 17px;
  font-weight: 900;
  line-height: 1.3;
}

.memory-subtype-card small {
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.retrieval-line {
  margin-top: auto;
  padding-top: 12px;
  border-top: 1px solid rgba(226, 232, 240, 0.9);
}

.retrieval-line span {
  margin-bottom: 6px;
}

.retrieval-line p {
  font-size: 13px;
}

.memory-list-panel {
  padding: 20px;
  border: 1px solid rgba(203, 213, 225, 0.75);
  border-radius: 8px;
  background: #ffffff;
}

.capability-domain-strip {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}

.capability-domain-card {
  min-height: 116px;
  padding: 16px;
  border: 1px solid rgba(20, 184, 166, 0.18);
  border-radius: 8px;
  background: #f0fdfa;
}

.capability-domain-card span,
.capability-domain-card small {
  display: block;
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

.capability-domain-card strong {
  display: block;
  margin: 10px 0 8px;
  color: #134e4a;
  font-size: 28px;
  font-weight: 950;
}

.capability-domain-card small {
  color: var(--text-secondary);
  line-height: 1.5;
}

.capability-surface-panel {
  padding: 20px;
  border: 1px solid rgba(203, 213, 225, 0.75);
  border-radius: 8px;
  background: #ffffff;
}

.capability-surface-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.capability-surface-card {
  min-height: 238px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 8px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.capability-surface-top {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.capability-surface-top span {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(15, 118, 110, 0.1);
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
}

.capability-surface-card h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 900;
  line-height: 1.35;
}

.capability-surface-card > p,
.capability-surface-card small {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.6;
}

.capability-action-line {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid rgba(226, 232, 240, 0.95);
}

.capability-action-line span {
  display: block;
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.capability-action-line p {
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 850;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.capability-tag-line {
  color: #0f766e;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.memory-list-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
}

.memory-list-head span {
  display: block;
  margin-bottom: 8px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.memory-list-head h3 {
  margin: 0;
  color: var(--text-primary);
  font-size: 18px;
  font-weight: 900;
}

.memory-list-head strong {
  color: #2563eb;
  font-size: 24px;
  font-weight: 950;
}

.memory-empty {
  padding: 28px;
  border: 1px dashed rgba(148, 163, 184, 0.7);
  border-radius: 8px;
  color: var(--text-tertiary);
  font-size: 14px;
  font-weight: 800;
  text-align: center;
}

.memory-item-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}

.memory-item {
  min-height: 210px;
  padding: 16px;
  border: 1px solid rgba(226, 232, 240, 0.95);
  border-radius: 8px;
  background: #f8fafc;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.memory-item-top {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.memory-item-stats {
  color: #2563eb;
  font-size: 12px;
  font-weight: 900;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.memory-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.memory-detail-link {
  flex-shrink: 0;
  padding: 4px 9px;
  border: 1px solid rgba(37, 99, 235, 0.2);
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.08);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
  text-decoration: none;
}

.memory-item-top span {
  width: fit-content;
  padding: 3px 8px;
  border-radius: 6px;
  background: rgba(37, 99, 235, 0.1);
  color: #1d4ed8;
  font-size: 12px;
  font-weight: 900;
}

.memory-item h4 {
  margin: 0;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 900;
  line-height: 1.35;
}

.memory-item > p {
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.65;
}

.memory-relations,
.memory-retrieval {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid rgba(226, 232, 240, 0.95);
}

.memory-relations + .memory-retrieval {
  margin-top: 0;
}

.memory-relations span,
.memory-retrieval span {
  display: block;
  margin-bottom: 6px;
  color: var(--text-tertiary);
  font-size: 12px;
  font-weight: 900;
}

.memory-relations p,
.memory-retrieval p {
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
  font-weight: 700;
  line-height: 1.6;
}

@media (max-width: 1280px) {
  .domain-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .memory-subtypes {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .memory-item-list {
    grid-template-columns: 1fr;
  }

  .hero-band,
  .domain-detail {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 760px) {
  .assets-page {
    padding: 16px;
  }

  .domain-grid,
  .domain-detail main,
  .memory-brief,
  .memory-subtypes {
    grid-template-columns: 1fr;
  }
}
</style>
