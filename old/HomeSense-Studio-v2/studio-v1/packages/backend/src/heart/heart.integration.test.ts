import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../db/index.js'
import { FakeEventBus, FakeLlmService } from '../test-support/index.js'
import { SqlMemoryRepository } from '../modules/memory-kernel/repository.js'
import { MemoryKernelService } from '../modules/memory-kernel/index.js'
import { SqlExperienceRepository } from '../modules/experience/repository.js'
import { InMemoryExperienceFileStore } from '../modules/experience/file-store.js'
import { ExperienceService } from '../modules/experience/index.js'
import { SqlSkillsRepository } from '../modules/skills-system/repository.js'
import { SkillsService } from '../modules/skills-system/index.js'
import { SqlKnowledgeCompilerRepository } from '../modules/knowledge-compiler/repository.js'
import { KnowledgeCompilerService } from '../modules/knowledge-compiler/index.js'
import { SelfEnhancementService } from '../modules/self-enhancement/index.js'

/**
 * Heart-of-system end-to-end integration tests.
 *
 * These prove that the five core modules wire up against a single in-memory
 * database and exercise the three "heart links" identified in the architecture
 * report:
 *   Link A · observe → recall reranking
 *   Link E · experience → skill auto-promotion (survives a "restart")
 *   Link F · failure → reflect → enhance (no real LLM, no real db file)
 */

function buildHeart() {
  const db = createInMemoryDb()
  const eventBus = new FakeEventBus()
  const llm = new FakeLlmService()

  const memoryRepo = new SqlMemoryRepository(() => db)
  const skillsRepo = new SqlSkillsRepository(() => db)
  const experienceRepo = new SqlExperienceRepository(() => db)
  const compilerRepo = new SqlKnowledgeCompilerRepository(() => db)
  const fileStore = new InMemoryExperienceFileStore('/heart/exp')

  const skills = new SkillsService(skillsRepo, eventBus)
  const memory = new MemoryKernelService(
    () => db,
    eventBus,
    llm,
    skills,
    memoryRepo,
  )
  const experience = new ExperienceService(experienceRepo, fileStore, eventBus, skills)
  const compiler = new KnowledgeCompilerService(compilerRepo, memory, { listPlans: () => [] }, {
    readFile: (p) => fileStore.fileExists(p) ? fileStore.readFile(p) : '',
  })
  const selfEnhancement = new SelfEnhancementService(
    {
      addRule: (rule) => {
        // store in db so we can assert
        db.prepare('INSERT INTO rules (trigger_pattern, priority, enabled) VALUES (?, ?, ?)').run(
          rule.trigger_pattern,
          rule.priority,
          rule.enabled ? 1 : 0,
        )
      },
    },
    {
      register: (skill) => skills.register({ ...skill, context_mode: skill.context_mode as 'inline' | 'fork', source: skill.source as 'builtin' | 'disk' | 'converted' }),
    },
  )

  return { db, eventBus, llm, memory, experience, skills, compiler, selfEnhancement, fileStore }
}

describe('Heart link A · observe → recall reranking', () => {
  it('three observations on same intent produce one entity, ranked correctly', () => {
    const heart = buildHeart()

    heart.memory.observeOutcome({ intent: 'turn_on_lamp', tool: 'mi-cli', action: 'set_prop', success: true })
    heart.memory.observeOutcome({ intent: 'turn_on_lamp', tool: 'mi-cli', action: 'set_prop', success: true })
    heart.memory.observeOutcome({ intent: 'turn_on_lamp', tool: 'mi-cli', action: 'set_prop', success: true })
    heart.memory.observeOutcome({ intent: 'turn_off_lamp', tool: 'mi-cli', action: 'set_prop', success: false, error: 'offline' })

    expect(heart.eventBus.countOf('memory_observation')).toBe(4)

    const recalled = heart.memory.recallObservations('turn_on_lamp', 5)
    expect(recalled.length).toBe(1)
    expect(recalled[0].success_count).toBe(3)
    expect(recalled[0].failure_count).toBe(0)

    const offRecalled = heart.memory.recallObservations('turn_off_lamp', 5)
    expect(offRecalled.length).toBe(1)
    expect(offRecalled[0].failure_count).toBe(1)
    expect(offRecalled[0].last_error).toBe('offline')
  })
})

describe('Heart link E · experience → skill auto-promotion across restart', () => {
  it('writes high-importance experience, promotes to skill, survives a fresh service instance', () => {
    const heart = buildHeart()

    const expId = heart.experience.writeExperience(
      'device-control',
      'watch bilibili on toshiba tv',
      '## Steps\n1. 调用 mi-cli scene_execute\n2. 调用 adb-cli launch_app\n',
      0.85,
    )
    expect(Number(expId)).toBeGreaterThan(0)
    expect(heart.eventBus.countOf('experience_converted_to_skill')).toBe(1)

    // First service finds it.
    const promotedName = `exp_device-control_watch_bilibili_on_toshiba_tv`
    expect(heart.skills.getSkill(promotedName)).toBeDefined()

    // Simulate restart: brand new service instance against same db.
    const freshSkillsRepo = new SqlSkillsRepository(() => heart.db)
    const fresh = new SkillsService(freshSkillsRepo, new FakeEventBus())

    expect(fresh.listSkills().length).toBe(0) // cold map
    fresh.loadAll()

    const restored = fresh.getSkill(promotedName)
    expect(restored).toBeDefined()
    expect(restored?.source).toBe('converted')
    expect(restored?.prompt_template).toContain('scene_execute')
  })

  it('low-importance experience does not promote, fresh restart finds nothing', () => {
    const heart = buildHeart()
    heart.experience.writeExperience('cat', 'low impact', '## step\n1. trivial', 0.4)

    expect(heart.eventBus.countOf('experience_converted_to_skill')).toBe(0)
    expect(heart.skills.listSkills().length).toBe(0)

    const fresh = new SkillsService(new SqlSkillsRepository(() => heart.db), new FakeEventBus())
    fresh.loadAll()
    expect(fresh.listSkills().length).toBe(0)
  })
})

describe('Heart link F · failure → reflect → enhance', () => {
  it('reflects on a device offline failure and generates a remediation skill', () => {
    const heart = buildHeart()

    heart.selfEnhancement.processFailureAndEnhance({
      task_type: 'device_control',
      input: 'turn on bedroom lamp',
      expected: 'lamp on',
      actual: 'timeout',
      error: 'Device offline',
      trace: [{ step: 'service_call', result: 'timeout', duration_ms: 5000 }],
    })

    // device_offline pattern should generate a skill (per ERROR_PATTERNS table).
    const generatedSkills = heart.skills.listSkills().filter((s) => s.source === 'converted' && s.name.startsWith('auto_'))
    expect(generatedSkills.length).toBeGreaterThan(0)
    expect(generatedSkills[0].description).toContain('设备离线')
  })

  it('reflects on a rule_miss failure and generates a rule (not a skill)', () => {
    const heart = buildHeart()

    heart.selfEnhancement.processFailureAndEnhance({
      task_type: 'rule_match',
      input: '随便说点什么',
      expected: 'matched rule',
      actual: 'no matching rule',
      error: 'No matching rule',
      trace: [],
    })

    // rule_miss pattern: can_generate_rule=true, can_generate_skill=false
    const ruleCount = (heart.db.prepare('SELECT COUNT(*) AS c FROM rules').get() as { c: number }).c
    expect(ruleCount).toBeGreaterThan(0)
  })
})

describe('Heart end-to-end · the system "feels different" after sleeping on it', () => {
  it('chain: experience write → compile → search finds it', () => {
    const heart = buildHeart()

    // Step 1: a successful execution writes an experience
    heart.experience.writeExperience(
      'scene',
      'watch bilibili demo',
      '## Steps\n1. 调用 mi-cli scene_execute\n2. 调用 adb-cli launch_app',
      0.8,
    )

    // Step 2: compile knowledge
    const result = heart.compiler.refreshKnowledge()
    expect(result.experience_notes).toBe(1)
    expect(result.compiled_plans).toBeGreaterThan(0)

    // Step 3: the compiled item is now searchable via memory.search
    const searchHits = heart.memory.search('bilibili')
    expect(searchHits.length).toBeGreaterThan(0)
    const hit = searchHits.find((h) => h.content.includes('bilibili') || h.content.includes('Bilibili'))
    expect(hit).toBeDefined()
  })
})
