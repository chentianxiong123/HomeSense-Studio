import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import { FakeEventBus, FakeLlmService } from '../../test-support/index.js'
import { SqlMemoryRepository } from './repository.js'
import { MemoryKernelService } from './index.js'

describe('memory-kernel · heart writes pass through repository', () => {
  it('observeOutcome via repository accumulates counts', () => {
    const db = createInMemoryDb()
    const repo = new SqlMemoryRepository(() => db)

    repo.upsertEntity({
      id: 'concept.runtime_observations.mi-cli.demo',
      name: 'intent:demo',
      type: 'concept',
      wing: 'runtime_observations',
      room: 'mi-cli',
      propertiesJson: '{}',
    })
    repo.upsertAttribute({
      entityId: 'concept.runtime_observations.mi-cli.demo',
      key: 'success_count',
      value: '3',
    })

    const found = repo.searchObservationEntitiesByName(['demo'], 5)
    expect(found.length).toBe(1)

    const attr = repo.getCurrentAttribute('concept.runtime_observations.mi-cli.demo', 'success_count')
    expect(attr?.value).toBe('3')
  })

  it('insertTriple roundtrip via repository', () => {
    const db = createInMemoryDb()
    const repo = new SqlMemoryRepository(() => db)

    repo.upsertEntity({ id: 'device.lamp', name: 'Lamp', type: 'device', wing: 'home', room: 'living', propertiesJson: '{}' })
    repo.upsertEntity({ id: 'room.living', name: 'Living', type: 'room', wing: 'home', room: 'living', propertiesJson: '{}' })

    repo.insertTriple({
      subject: 'device.lamp',
      predicate: 'located_in',
      object: 'room.living',
      confidence: 0.9,
      source: 'test',
      sourceFile: '',
    })

    const triples = repo.listCurrentTriplesByEntity('device.lamp')
    expect(triples.length).toBe(1)
    expect(triples[0].predicate).toBe('located_in')
    expect(repo.listAllCurrentTriples().length).toBe(1)
  })

  it('upsertCompiledKnowledge + FTS roundtrip via repository', () => {
    const db = createInMemoryDb()
    const repo = new SqlMemoryRepository(() => db)

    const id = repo.upsertCompiledKnowledge({
      kind: 'compiled_plan',
      title: 'Watch bilibili on TV',
      body: 'Step 1: open scene. Step 2: launch app.',
      wing: 'home',
      room: 'living',
      sourceType: 'plan',
      sourceRef: 'plan_demo',
      tagsJson: '[]',
      metadataJson: '{}',
      embeddingProfile: null,
      rankScore: 0.9,
    })
    expect(id).toBeGreaterThan(0)

    repo.insertCompiledKnowledgeFts({
      rowid: id,
      title: 'Watch bilibili on TV',
      body: 'Step 1: open scene. Step 2: launch app.',
      kind: 'compiled_plan',
      wing: 'home',
      room: 'living',
      sourceRef: 'plan_demo',
    })

    const ftsHits = repo.searchCompiledKnowledgeFts('bilibili', 5)
    expect(ftsHits.length).toBeGreaterThan(0)
    expect(ftsHits[0].title).toContain('bilibili')
    expect(repo.countCompiledKnowledge()).toBe(1)
  })
})

describe('MemoryKernelService · service-level decoupling', () => {
  it('observeOutcome end-to-end on in-memory db with fake event bus', () => {
    const db = createInMemoryDb()
    const eventBus = new FakeEventBus()
    const llm = new FakeLlmService()
    const skills = { getSkill: () => undefined }
    const repo = new SqlMemoryRepository(() => db)

    const service = new MemoryKernelService(() => db, eventBus, llm, skills, repo)

    service.observeOutcome({ intent: 'turn_on_lamp', tool: 'mi-cli', action: 'set_prop', success: true })
    service.observeOutcome({ intent: 'turn_on_lamp', tool: 'mi-cli', action: 'set_prop', success: true })
    service.observeOutcome({ intent: 'turn_on_lamp', tool: 'mi-cli', action: 'set_prop', success: false })

    expect(eventBus.countOf('memory_observation')).toBe(3)

    const recalled = service.recallObservations('turn_on_lamp', 5)
    expect(recalled.length).toBe(1)
    expect(recalled[0].success_count).toBe(2)
    expect(recalled[0].failure_count).toBe(1)
  })

  it('remember + recall roundtrip end-to-end', () => {
    const db = createInMemoryDb()
    const eventBus = new FakeEventBus()
    const llm = new FakeLlmService()
    const skills = { getSkill: () => undefined }
    const repo = new SqlMemoryRepository(() => db)

    const service = new MemoryKernelService(() => db, eventBus, llm, skills, repo)

    service.remember('user prefers warm light in the bedroom', {
      type: 'person',
      wing: 'home',
      room: 'preference',
      confidence: 0.9,
    })

    expect(eventBus.countOf('memory_remembered')).toBe(1)

    const recalled = service.recall('home', 'preference')
    expect(recalled.length).toBe(1)
    expect(recalled[0].entity).toBeDefined()
  })
})
