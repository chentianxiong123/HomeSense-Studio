export type SlotName = 'planner' | 'fast' | 'vision' | 'embedding' | 'rerank' | 'local'

export type SlotSection = {
  slot: SlotName
  title: string
  description: string
  supportsDimensions: boolean
}

const SLOT_META: Record<SlotName, { zh: string; en: string; zhDesc: string; enDesc: string; supportsDimensions?: boolean }> = {
  planner: {
    zh: '规划模型',
    en: 'Planner',
    zhDesc: '复杂推理、工作流规划、工具编排。',
    enDesc: 'Complex reasoning, workflow planning, and tool orchestration.',
  },
  fast: {
    zh: '快速模型',
    en: 'Fast',
    zhDesc: '日常聊天、轻量响应、低成本调用。',
    enDesc: 'Everyday chat, lightweight responses, and lower-cost calls.',
  },
  vision: {
    zh: '视觉模型',
    en: 'Vision',
    zhDesc: '识图、多模态兜底、屏幕理解。',
    enDesc: 'Visual understanding, multimodal fallback, and screen interpretation.',
  },
  embedding: {
    zh: '向量模型',
    en: 'Embedding',
    zhDesc: '记忆向量化与检索基础，切换需谨慎。',
    enDesc: 'Memory vectorization and retrieval foundation; changing it has consequences.',
    supportsDimensions: true,
  },
  rerank: {
    zh: '重排序模型',
    en: 'Rerank',
    zhDesc: '检索结果重排，用于提升记忆和知识命中质量。',
    enDesc: 'Retrieval reranking for better memory and knowledge hit quality.',
  },
  local: {
    zh: '本地后备模型',
    en: 'Local',
    zhDesc: '本地兜底或未来离线能力入口。',
    enDesc: 'Local fallback or future offline capability entry.',
  },
}

export function buildSlotSections(label: (zh: string, en: string) => string): SlotSection[] {
  return (['planner', 'fast', 'vision', 'embedding', 'rerank', 'local'] as SlotName[]).map((slot) => ({
    slot,
    title: label(SLOT_META[slot].zh, SLOT_META[slot].en),
    description: label(SLOT_META[slot].zhDesc, SLOT_META[slot].enDesc),
    supportsDimensions: Boolean(SLOT_META[slot].supportsDimensions),
  }))
}
