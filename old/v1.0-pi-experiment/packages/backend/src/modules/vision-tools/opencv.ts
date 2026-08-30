import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { getDb } from '../../db/index.js'

export interface OpenCvPreprocessInput {
  imageBase64: string
  mimeType?: string
  packageName?: string
  elementName?: string
}

export interface OpenCvPreprocessResult {
  imageBase64: string
  mimeType: string
  operations: Array<{
    name: string
    applied: boolean
    reason?: string
  }>
}

export async function preprocessScreenshotWithOpenCV(
  input: OpenCvPreprocessInput,
): Promise<OpenCvPreprocessResult> {
  return {
    imageBase64: input.imageBase64,
    mimeType: input.mimeType ?? 'image/png',
    operations: [
      {
        name: 'passthrough',
        applied: true,
        reason: 'Image passed through without preprocessing (no native OpenCV).',
      },
    ],
  }
}

export interface OpenCvTemplateMatch {
  templatePath: string
  bounds: { x: number; y: number; width: number; height: number }
  confidence: number
  element_name: string
}

export interface TemplateCacheEntry {
  id: number
  package_name: string
  element_name: string
  template_hash: string
  template_path: string
  bounds_json: string
  confidence: number
  hit_count: number
  created_at: string
  last_matched_at: string
}

const TEMPLATE_DIR = path.resolve(process.env.DATA_DIR || '.', 'data', 'templates')

export function ensureTemplateDir(): void {
  if (!fs.existsSync(TEMPLATE_DIR)) {
    fs.mkdirSync(TEMPLATE_DIR, { recursive: true })
  }
}

export function storeTemplate(params: {
  packageName: string
  elementName: string
  imageBase64: string
  bounds: { x: number; y: number; width: number; height: number }
  confidence: number
}): string {
  ensureTemplateDir()
  const hash = createHash('sha1').update(params.imageBase64).digest('hex').slice(0, 16)
  const filename = `${params.packageName.replace(/\./g, '_')}_${hash}.png`
  const filePath = path.join(TEMPLATE_DIR, filename)

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, Buffer.from(params.imageBase64, 'base64'))
  }

  const db = getDb()
  db.prepare(`
    INSERT INTO opencv_templates (package_name, element_name, template_hash, template_path, bounds_json, confidence)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(template_hash) DO UPDATE SET
      hit_count = opencv_templates.hit_count,
      last_matched_at = datetime('now')
  `).run(
    params.packageName,
    params.elementName,
    hash,
    filePath,
    JSON.stringify(params.bounds),
    params.confidence,
  )

  return filePath
}

export function findCachedTemplates(packageName: string, elementName: string): TemplateCacheEntry[] {
  const db = getDb()
  return db.prepare(`
    SELECT * FROM opencv_templates
    WHERE package_name = ? AND element_name LIKE ?
    ORDER BY hit_count DESC, confidence DESC, last_matched_at DESC
    LIMIT 5
  `).all(packageName, `%${elementName}%`) as TemplateCacheEntry[]
}

export function bumpTemplateHit(templateHash: string): void {
  const db = getDb()
  db.prepare(`
    UPDATE opencv_templates
    SET hit_count = hit_count + 1, last_matched_at = datetime('now')
    WHERE template_hash = ?
  `).run(templateHash)
}

export async function matchTemplatesWithOpenCV(params?: {
  packageName?: string
  elementName?: string
  screenshotBase64?: string
}): Promise<OpenCvTemplateMatch[]> {
  if (!params?.packageName || !params?.elementName) return []

  const cached = findCachedTemplates(params.packageName, params.elementName)
  if (cached.length === 0) return []

  return cached
    .filter((entry) => fs.existsSync(entry.template_path))
    .map((entry) => {
      bumpTemplateHit(entry.template_hash)
      const bounds = JSON.parse(entry.bounds_json) as { x: number; y: number; width: number; height: number }
      return {
        templatePath: entry.template_path,
        bounds,
        confidence: entry.confidence,
        element_name: entry.element_name,
      }
    })
}
