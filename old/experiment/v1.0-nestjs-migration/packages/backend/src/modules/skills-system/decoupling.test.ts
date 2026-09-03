import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import { FakeEventBus } from '../../test-support/index.js'
import { SkillsService, type SkillDefinition } from './index.js'
import { SqlSkillsRepository, type SkillsRepository } from './repository.js'

function makeSkill(over: Partial<SkillDefinition> = {}): SkillDefinition {
  return {
    name: 'test_skill',
    description: 'a skill',
    prompt_template: 'do the thing',
    allowed_tools_json: '["mi-cli"]',
    action_schema_json: '[]',
    context_mode: 'inline',
    source: 'builtin',
    skill_root: '',
    enabled: true,
    ...over,
  }
}

describe('SkillsService · register persists; loadAll restores after restart', () => {
  it('register writes to db and to in-memory map', () => {
    const db = createInMemoryDb()
    const repo = new SqlSkillsRepository(() => db)
    const bus = new FakeEventBus()
    const svc = new SkillsService(repo, bus)

    svc.register(makeSkill({ name: 'lamp_skill' }))

    expect(svc.getSkill('lamp_skill')).toBeDefined()
    expect(bus.countOf('skill_registered')).toBe(1)

    const dbRow = db.prepare('SELECT name FROM skills WHERE name = ?').get('lamp_skill') as { name: string }
    expect(dbRow.name).toBe('lamp_skill')
  })

  it('after a fresh service instance against the same db, loadAll reloads converted skills', () => {
    const db = createInMemoryDb()
    const repo1 = new SqlSkillsRepository(() => db)
    const svc1 = new SkillsService(repo1, new FakeEventBus())

    svc1.register(makeSkill({ name: 'exp_promoted', source: 'converted' }))
    svc1.register(makeSkill({ name: 'disk_lamp', source: 'disk' }))

    // Simulate a process restart: brand new service instance, same db.
    const repo2 = new SqlSkillsRepository(() => db)
    const svc2 = new SkillsService(repo2, new FakeEventBus())

    // Without loadAll, the new instance's map is empty.
    expect(svc2.listSkills().length).toBe(0)

    const loaded = svc2.loadAll()
    expect(loaded).toBe(2)
    expect(svc2.getSkill('exp_promoted')?.source).toBe('converted')
    expect(svc2.getSkill('disk_lamp')?.source).toBe('disk')
  })

  it('getSkill falls back to db lookup if not in cache', () => {
    const db = createInMemoryDb()
    const repo = new SqlSkillsRepository(() => db)
    const svc = new SkillsService(repo, new FakeEventBus())

    // Insert a row directly via repo without going through register.
    repo.upsertSkill(makeSkill({ name: 'externally_added' }))

    // Cache is empty initially.
    expect(svc.listSkills().length).toBe(0)

    const found = svc.getSkill('externally_added')
    expect(found).toBeDefined()
    expect(found?.name).toBe('externally_added')
    // Now it's in the cache.
    expect(svc.listSkills().some((s) => s.name === 'externally_added')).toBe(true)
  })

  it('disabled skills are not loaded by loadAll', () => {
    const db = createInMemoryDb()
    const repo = new SqlSkillsRepository(() => db)
    const svc = new SkillsService(repo, new FakeEventBus())

    svc.register(makeSkill({ name: 'active_one' }))
    svc.register(makeSkill({ name: 'disabled_one', enabled: false }))

    const fresh = new SkillsService(new SqlSkillsRepository(() => db), new FakeEventBus())
    fresh.loadAll()
    expect(fresh.getSkill('active_one')).toBeDefined()
    expect(fresh.getSkill('disabled_one')).toBeUndefined()
  })
})

describe('SkillsService · pure fake repository', () => {
  it('runs with a Map-only fake — no db at all', () => {
    const fakeRepo: SkillsRepository = (() => {
      const store = new Map<string, SkillDefinition>()
      return {
        upsertSkill(skill) { store.set(skill.name, skill) },
        getSkill(name) { return store.get(name) },
        listAllEnabled() { return Array.from(store.values()).filter((s) => s.enabled) },
        listBySource(src) { return Array.from(store.values()).filter((s) => s.source === src) },
        countAll() { return store.size },
      }
    })()

    const svc = new SkillsService(fakeRepo, new FakeEventBus())
    svc.register(makeSkill({ name: 'pure_fake', source: 'converted' }))

    expect(svc.getSkill('pure_fake')?.source).toBe('converted')
    expect(fakeRepo.countAll()).toBe(1)

    const fresh = new SkillsService(fakeRepo, new FakeEventBus())
    fresh.loadAll()
    expect(fresh.getSkill('pure_fake')).toBeDefined()
  })
})
