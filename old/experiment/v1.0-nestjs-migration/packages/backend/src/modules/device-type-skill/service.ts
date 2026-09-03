import fs from 'fs'
import path from 'path'

export interface DeviceTypeSkillAsset {
  id: string
  asset_type: 'device_skill'
  device_type: string
  title: string
  summary: string
  status: 'active' | 'draft'
  load_policy: 'on_device_type_match'
  when_to_load: string[]
  preferred_tools: string[]
  common_paths: Array<{
    intent: string
    steps: string[]
  }>
  argument_rules: Record<string, string>
  failure_recovery: string[]
  skill_root: string
}

export interface DeviceTypeSkillDetail extends DeviceTypeSkillAsset {
  body: string
}

export function listDeviceTypeSkills(): DeviceTypeSkillAsset[] {
  return readDeviceTypeSkills().map(({ body: _body, ...skill }) => skill)
}

export function getDeviceTypeSkill(idOrType: string): DeviceTypeSkillDetail | undefined {
  return readDeviceTypeSkills().find((skill) => skill.id === idOrType || skill.device_type === idOrType)
}

function readDeviceTypeSkills(): DeviceTypeSkillDetail[] {
  const root = resolveSkillsRoot()
  if (!fs.existsSync(root)) return []

  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'SKILL.md'))
    .filter((file) => fs.existsSync(file))
    .map(readSkillFile)
    .filter((skill): skill is DeviceTypeSkillDetail => Boolean(skill))
    .sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'))
}

function readSkillFile(file: string): DeviceTypeSkillDetail | null {
  const content = fs.readFileSync(file, 'utf-8')
  const { frontmatter, body } = parseFrontmatter(content)
  const name = String(frontmatter.name ?? '').trim()
  const deviceType = String(frontmatter.device_type ?? '').trim()
  if (!name.startsWith('device_skill.') || !deviceType) return null

  return {
    id: name,
    asset_type: 'device_skill',
    device_type: deviceType,
    title: String(frontmatter.title ?? deviceType),
    summary: String(frontmatter.description ?? ''),
    status: frontmatter.status === 'draft' ? 'draft' : 'active',
    load_policy: 'on_device_type_match',
    when_to_load: readBulletSection(body, 'When to load'),
    preferred_tools: readListFrontmatter(frontmatter.allowed_tools),
    common_paths: readCommonPaths(body),
    argument_rules: readKeyValueBullets(body, 'Argument rules'),
    failure_recovery: readBulletSection(body, 'Failure recovery'),
    skill_root: path.dirname(file),
    body: body.trim(),
  }
}

function resolveSkillsRoot(): string {
  const candidates = [
    path.resolve(process.cwd(), 'skills'),
    path.resolve(process.cwd(), '../../skills'),
    path.resolve(process.cwd(), '../skills'),
  ]
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? candidates[0]
}

function parseFrontmatter(content: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) return { frontmatter: {}, body: content }

  const frontmatter: Record<string, unknown> = {}
  const lines = match[1].split(/\r?\n/)
  let listKey: string | null = null
  for (const rawLine of lines) {
    const line = rawLine.trim()
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/)
    if (kv) {
      const [, key, rawValue] = kv
      const value = rawValue.trim().replace(/^"|"$/g, '')
      listKey = value ? null : key
      frontmatter[key] = value || []
      continue
    }

    const item = line.match(/^-\s+(.+)$/)
    if (item && listKey) {
      const current = Array.isArray(frontmatter[listKey]) ? frontmatter[listKey] as string[] : []
      current.push(item[1].trim())
      frontmatter[listKey] = current
    }
  }

  return { frontmatter, body: content.slice(match[0].length) }
}

function readListFrontmatter(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : []
}

function readBulletSection(body: string, heading: string): string[] {
  const block = readSection(body, heading)
  return block
    .split(/\r?\n/)
    .map((line) => line.trim().match(/^-\s+(.+)$/)?.[1]?.trim())
    .filter((line): line is string => Boolean(line))
}

function readKeyValueBullets(body: string, heading: string): Record<string, string> {
  const result: Record<string, string> = {}
  for (const line of readBulletSection(body, heading)) {
    const match = line.match(/^`?([^`：:]+)`?[：:]\s*(.+)$/)
    if (match) result[match[1].trim()] = match[2].trim()
  }
  return result
}

function readCommonPaths(body: string): DeviceTypeSkillAsset['common_paths'] {
  const block = readSection(body, 'Common paths')
  const sections = block.split(/^###\s+/m).slice(1)
  return sections.map((section) => {
    const [heading, ...rest] = section.split(/\r?\n/)
    return {
      intent: heading.trim(),
      steps: rest
        .map((line) => line.trim().match(/^-\s+(.+)$/)?.[1]?.trim())
        .filter((line): line is string => Boolean(line)),
    }
  }).filter((item) => item.intent)
}

function readSection(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = body.match(new RegExp(`^##\\s+${escaped}\\s*$([\\s\\S]*?)(?=^##\\s+|\\s*$)`, 'm'))
  return match?.[1] ?? ''
}
