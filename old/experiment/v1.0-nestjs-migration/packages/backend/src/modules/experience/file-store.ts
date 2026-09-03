import fs from 'fs'
import path from 'path'

export interface ExperienceFileStore {
  ensureCategoryDir(category: string): void
  writeExperienceFile(filePath: string, content: string): void
  readExperienceBody(filePath: string): string
  updateFrontmatterConverted(filePath: string, converted: boolean): void
  resolveFilePath(category: string, fileName: string): string
  listCategoryDirs(): string[]
  listFilesInCategory(categoryDir: string): string[]
  fileExists(filePath: string): boolean
  readFile(filePath: string): string
}

export class FsExperienceFileStore implements ExperienceFileStore {
  constructor(private readonly rootDir: string) {}

  ensureCategoryDir(category: string): void {
    const dir = path.join(this.rootDir, category)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }

  writeExperienceFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, 'utf-8')
  }

  readExperienceBody(filePath: string): string {
    try {
      if (!fs.existsSync(filePath)) return ''
      const content = fs.readFileSync(filePath, 'utf-8')
      const bodyStart = content.indexOf('---', content.indexOf('---') + 3)
      if (bodyStart !== -1) {
        return content.slice(bodyStart + 3).trim()
      }
      return content
    } catch {
      return ''
    }
  }

  updateFrontmatterConverted(filePath: string, converted: boolean): void {
    try {
      if (!fs.existsSync(filePath)) return
      let content = fs.readFileSync(filePath, 'utf-8')
      content = content.replace(
        /converted_to_skill:\s*(true|false)/,
        `converted_to_skill: ${converted}`,
      )
      fs.writeFileSync(filePath, content, 'utf-8')
    } catch {}
  }

  resolveFilePath(category: string, fileName: string): string {
    return path.join(this.rootDir, category, fileName)
  }

  listCategoryDirs(): string[] {
    if (!fs.existsSync(this.rootDir)) return []
    return fs
      .readdirSync(this.rootDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(this.rootDir, entry.name))
  }

  listFilesInCategory(categoryDir: string): string[] {
    if (!fs.existsSync(categoryDir)) return []
    return fs
      .readdirSync(categoryDir)
      .filter((file) => file.endsWith('.md'))
      .map((file) => path.join(categoryDir, file))
  }

  fileExists(filePath: string): boolean {
    return fs.existsSync(filePath)
  }

  readFile(filePath: string): string {
    return fs.readFileSync(filePath, 'utf-8')
  }
}

export class InMemoryExperienceFileStore implements ExperienceFileStore {
  private readonly files = new Map<string, string>()
  private readonly categories = new Set<string>()

  constructor(private readonly rootDir: string = '/fake/experiences') {}

  ensureCategoryDir(category: string): void {
    this.categories.add(category)
  }

  writeExperienceFile(filePath: string, content: string): void {
    this.files.set(filePath, content)
  }

  readExperienceBody(filePath: string): string {
    const content = this.files.get(filePath)
    if (!content) return ''
    const bodyStart = content.indexOf('---', content.indexOf('---') + 3)
    if (bodyStart !== -1) return content.slice(bodyStart + 3).trim()
    return content
  }

  updateFrontmatterConverted(filePath: string, converted: boolean): void {
    const existing = this.files.get(filePath)
    if (!existing) return
    this.files.set(
      filePath,
      existing.replace(/converted_to_skill:\s*(true|false)/, `converted_to_skill: ${converted}`),
    )
  }

  resolveFilePath(category: string, fileName: string): string {
    return `${this.rootDir}/${category}/${fileName}`
  }

  listCategoryDirs(): string[] {
    return Array.from(this.categories).map((c) => `${this.rootDir}/${c}`)
  }

  listFilesInCategory(categoryDir: string): string[] {
    const prefix = `${categoryDir}/`
    return Array.from(this.files.keys()).filter((p) => p.startsWith(prefix))
  }

  fileExists(filePath: string): boolean {
    return this.files.has(filePath)
  }

  readFile(filePath: string): string {
    return this.files.get(filePath) ?? ''
  }

  // test helpers
  allFiles(): Map<string, string> {
    return new Map(this.files)
  }
}
