import { describe, expect, it } from 'vitest'
import { buildSlotSections, type SlotName } from './llmSlots'

const label = (zh: string, en: string) => `${zh}|${en}`

describe('buildSlotSections', () => {
  it('returns slot metadata in stable display order with localized names', () => {
    const sections = buildSlotSections(label)

    expect(sections.map((section) => section.slot)).toEqual<SlotName[]>([
      'planner',
      'fast',
      'vision',
      'embedding',
      'rerank',
      'local',
    ])

    expect(sections[0]).toMatchObject({
      slot: 'planner',
      title: '规划模型|Planner',
    })

    expect(sections[2]).toMatchObject({
      slot: 'vision',
      title: '视觉模型|Vision',
    })

    expect(sections[4]).toMatchObject({
      slot: 'rerank',
      title: '重排序模型|Rerank',
    })
  })
})
