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

  it('graph substrate stores nodes, edges, and neighborhoods', () => {
    const db = createInMemoryDb()
    const repo = new SqlMemoryRepository(() => db)

    repo.upsertGraphNode({
      id: 'device.tv.toshiba',
      type: 'device',
      label: 'Toshiba TV',
      scope: 'home.living_room',
      embeddingRef: '',
      metadataJson: '{"rank_score":0.8}',
    })
    repo.upsertGraphNode({
      id: 'app.bilibili.tv',
      type: 'app',
      label: 'Bilibili TV',
      scope: 'home.living_room',
      embeddingRef: '',
      metadataJson: '{}',
    })

    const edgeId = repo.upsertGraphEdge({
      fromNodeId: 'device.tv.toshiba',
      toNodeId: 'app.bilibili.tv',
      relation: 'can_launch',
      weight: 0.9,
      confidence: 0.95,
      validFrom: '2026-05-29T00:00:00.000Z',
      validTo: null,
      sourceType: 'test',
      sourceRef: 'graph-substrate-test',
      metadataJson: '{}',
    })

    expect(edgeId).toBeGreaterThan(0)
    expect(repo.searchGraphNodesByLike(['Bilibili'], 5)[0].id).toBe('app.bilibili.tv')
    const neighbors = repo.listGraphNeighbors('device.tv.toshiba', 5)
    expect(neighbors.length).toBe(1)
    expect(neighbors[0].neighbor_id).toBe('app.bilibili.tv')
    expect(neighbors[0].confidence).toBe(0.95)
    expect(neighbors[0].source_ref).toBe('graph-substrate-test')
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

  it('graph substrate participates in MemoryKernel search', () => {
    const db = createInMemoryDb()
    const eventBus = new FakeEventBus()
    const llm = new FakeLlmService()
    const skills = { getSkill: () => undefined }
    const repo = new SqlMemoryRepository(() => db)

    const service = new MemoryKernelService(() => db, eventBus, llm, skills, repo)
    service.upsertGraphNode({
      id: 'screen.bilibili.home',
      type: 'screen',
      label: 'Bilibili home screen',
      scope: 'tv.bilibili',
      metadata: { rank_score: 0.82 },
    })

    const hits = service.search('Bilibili')
    expect(hits.some((hit) => hit.id === 'graph_node_screen.bilibili.home')).toBe(true)
    expect(service.searchGraph('Bilibili')[0].id).toBe('screen.bilibili.home')
  })
})
