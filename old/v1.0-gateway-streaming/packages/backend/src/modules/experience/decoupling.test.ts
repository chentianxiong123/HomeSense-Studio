import { describe, it, expect } from 'vitest'
import { createInMemoryDb } from '../../db/index.js'
import { FakeEventBus } from '../../test-support/index.js'
import { ExperienceService } from './index.js'
import { SqlExperienceRepository } from './repository.js'
import { InMemoryExperienceFileStore } from './file-store.js'

interface RegisteredSkill {
  name: string
  source: string
  prompt_template: string
}

class FakeSkillsService {
  readonly registered: RegisteredSkill[] = []
  register(skill: RegisteredSkill): void {
    this.registered.push(skill)
  }
}

describe('experience · heart link C (write) and E (skill promotion)', () => {
  it('writeExperience writes to db, fts, and file store — no real fs touched', () => {
    const db = createInMemoryDb()
    const repo = new SqlExperienceRepository(() => db)
    const files = new InMemoryExperienceFileStore('/fake/exp')
    const bus = new FakeEventBus()
    const skills = new FakeSkillsService()

    const service = new ExperienceService(repo, files, bus, skills)
    const id = service.writeExperience(
      'device-control',
      'turn-on-living-lamp',
      '## Steps\n1. call mi-cli set_prop\n',
      0.6, // below promotion threshold
    )

    expect(Number(id)).toBeGreaterThan(0)
    expect(bus.countOf('experience_written')).toBe(1)
    expect(skills.registered.length).toBe(0) // 0.6 < 0.7, no promotion

    // db row exists
    const row = db.prepare('SELECT * FROM experiences WHERE id = ?').get(Number(id)) as { title: string; importance: number }
    expect(row.title).toBe('turn-on-living-lamp')
    expect(row.importance).toBe(0.6)

    // fts indexed
    const ftsHits = db.prepare('SELECT title FROM experiences_fts WHERE experiences_fts MATCH ?').all('lamp') as Array<{ title: string }>
    expect(ftsHits.length).toBeGreaterThan(0)

    // file store has the markdown
    const allFiles = files.allFiles()
    expect(allFiles.size).toBe(1)
    const [filePath, fileContent] = Array.from(allFiles.entries())[0]
    expect(filePath).toContain('turn-on-living-lamp.md')
    expect(fileContent).toContain('importance: 0.6')
    expect(fileContent).toContain('converted_to_skill: false')
  })

  it('writeExperience with importance >= 0.7 auto-promotes to a converted skill', () => {
    const db = createInMemoryDb()
    const repo = new SqlExperienceRepository(() => db)
    const files = new InMemoryExperienceFileStore('/fake/exp')
    const bus = new FakeEventBus()
    const skills = new FakeSkillsService()

    const service = new ExperienceService(repo, files, bus, skills)
    service.writeExperience(
      'device-control',
      'watch-bilibili-on-tv',
      '## Steps\n1. 调用 mi-cli scene_execute\n2. 调用 adb-cli launch_app\n',
      0.85,
    )

    expect(bus.countOf('experience_written')).toBe(1)
    expect(bus.countOf('experience_converted_to_skill')).toBe(1)
    expect(skills.registered.length).toBe(1)

    const skill = skills.registered[0]
    expect(skill.source).toBe('converted')
    expect(skill.name).toContain('watch-bilibili-on-tv')
    expect(skill.prompt_template).toContain('scene_execute')

    // file frontmatter updated
    const fileContent = Array.from(files.allFiles().values())[0]
    expect(fileContent).toContain('converted_to_skill: true')
  })

  it('content_hash dedupe: same content twice returns same id, no double promotion', () => {
    const db = createInMemoryDb()
    const repo = new SqlExperienceRepository(() => db)
    const files = new InMemoryExperienceFileStore('/fake/exp')
    const bus = new FakeEventBus()
    const skills = new FakeSkillsService()

    const service = new ExperienceService(repo, files, bus, skills)
    const id1 = service.writeExperience('cat', 'title-1', '## same content', 0.8)
    const id2 = service.writeExperience('cat', 'title-1', '## same content', 0.8)

    expect(id1).toBe(id2)
    expect(bus.countOf('experience_written')).toBe(1)
    expect(skills.registered.length).toBe(1)
  })

  it('recallExperiences finds entries by FTS', () => {
    const db = createInMemoryDb()
    const repo = new SqlExperienceRepository(() => db)
    const files = new InMemoryExperienceFileStore('/fake/exp')
    const bus = new FakeEventBus()
    const skills = new FakeSkillsService()

    const service = new ExperienceService(repo, files, bus, skills)
    service.writeExperience('device-control', 'turn on lamp', 'control the lamp via mi-cli', 0.5)
    service.writeExperience('scene', 'watch bilibili on tv', 'launch bilibili app on tv', 0.5)
    service.writeExperience('scene', 'morning routine', 'open curtains and play radio', 0.4)

    const hits = service.recallExperiences('bilibili', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.title.includes('bilibili'))).toBe(true)
  })
})
