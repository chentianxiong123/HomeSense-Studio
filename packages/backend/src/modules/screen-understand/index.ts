import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { getDb } from '../../db/index.js'
import { llmService } from '../llm-provider/service.js'
import { preprocessScreenshotWithOpenCV, matchTemplatesWithOpenCV, storeTemplate } from '../vision-tools/opencv.js'

export interface AppMapScreen {
  id: number
  package_name: string
  screen_id: string
  activity: string
  screenshot_path: string
  resolution: string
  captured_at: string
}

export interface AppMapElement {
  id: number
  screen_id: number
  element_name: string
  element_type: string
  bounds_json: { x: number; y: number; width: number; height: number }
  template_path: string
  confidence: number
  hit_count: number
  source: 'vision' | 'ui_tree' | 'manual'
  last_seen_at: string
  created_at: string
}

export interface ScreenUiTreeElement {
  index?: number
  text?: string
  content_desc?: string
  class?: string
  class_name?: string
  resource_id?: string
  bounds?: string | number[] | Record<string, unknown>
  center?: number[] | { x?: number; y?: number }
  clickable?: boolean
  enabled?: boolean
  selected?: boolean
}

export interface ScreenUiTreeInput {
  elements?: ScreenUiTreeElement[]
  formatted?: string
}

export interface ScreenScreenshotInput {
  path?: string
  data?: string
  base64?: string
  mime_type?: string
  width?: number
  height?: number
  synthetic?: boolean
}

export interface ScreenUnderstandResult {
  package_name: string
  screen_id: string
  elements: AppMapElement[]
  source: 'cache' | 'ui_tree' | 'vision' | 'empty'
  cached: boolean
}

interface VisionElement {
  name: string
  type: string
  bounds: { x: number; y: number; width: number; height: number }
  confidence: number
}

class ScreenUnderstandService {
  async resolveElement(params: {
    package_name: string
    element_name: string
    ui_tree?: ScreenUiTreeInput | null
    screenshot?: ScreenScreenshotInput | null
  }): Promise<ScreenUnderstandResult> {
    const cached = this.findCachedScreen(params.package_name, params.element_name)
    if (cached) return cached

    const templateMatches = await matchTemplatesWithOpenCV({
      packageName: params.package_name,
      elementName: params.element_name,
    })
    if (templateMatches.length > 0) {
      const screenId = `template:${params.package_name}`
      const screenDbId = this.ensureScreen({ packageName: params.package_name, screenId })
      const elements: AppMapElement[] = templateMatches.map((match) => ({
        id: 0,
        screen_id: screenDbId,
        element_name: match.element_name,
        element_type: 'button',
        bounds_json: match.bounds,
        template_path: match.templatePath,
        confidence: match.confidence,
        hit_count: 1,
        source: 'vision' as const,
        last_seen_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      }))
      return {
        package_name: params.package_name,
        screen_id: screenId,
        elements,
        source: 'cache',
        cached: true,
      }
    }

    if (params.ui_tree) {
      const fromTree = this.resolveFromUiTree(params.package_name, params.element_name, params.ui_tree)
      if (fromTree.elements.length > 0) return fromTree
    }

    if (params.screenshot) {
      const fromVision = await this.resolveFromScreenshot(params.package_name, params.element_name, params.screenshot)
      if (fromVision.elements.length > 0) return fromVision
    }

    return {
      package_name: params.package_name,
      screen_id: '',
      elements: [],
      source: 'empty',
      cached: false,
    }
  }

  listElements(packageName: string): AppMapElement[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT e.* FROM app_map_elements e
      JOIN app_map_screens s ON e.screen_id = s.id
      WHERE s.package_name = ?
      ORDER BY e.hit_count DESC, e.last_seen_at DESC
    `).all(packageName) as Array<Record<string, unknown>>
    return rows.map((row) => this.normalizeElement(row))
  }

  listScreens(packageName: string): AppMapScreen[] {
    const db = getDb()
    return db.prepare(
      'SELECT id, package_name, screen_id, activity, screenshot_path, resolution, captured_at FROM app_map_screens WHERE package_name = ? ORDER BY captured_at DESC',
    ).all(packageName) as AppMapScreen[]
  }

  addElement(params: {
    package_name: string
    screen_id?: string
    element_name: string
    element_type?: string
    bounds: { x: number; y: number; width: number; height: number }
    template_path?: string
  }): number {
    const screenDbId = this.ensureScreen({
      packageName: params.package_name,
      screenId: params.screen_id || 'manual',
    })
    return this.storeElement({
      screenDbId,
      name: params.element_name,
      type: params.element_type ?? 'button',
      bounds: params.bounds,
      templatePath: params.template_path ?? '',
      confidence: 1,
      source: 'manual',
    })
  }

  private findCachedScreen(packageName: string, elementName: string): ScreenUnderstandResult | null {
    const db = getDb()
    const row = db.prepare(`
      SELECT s.id AS screen_db_id, s.screen_id, e.id AS element_id
      FROM app_map_elements e
      JOIN app_map_screens s ON e.screen_id = s.id
      WHERE s.package_name = ? AND e.element_name LIKE ?
      ORDER BY e.hit_count DESC, e.confidence DESC, e.last_seen_at DESC
      LIMIT 1
    `).get(packageName, `%${elementName}%`) as { screen_db_id: number; screen_id: string; element_id: number } | undefined

    if (!row) return null

    this.bumpHitCount(row.element_id)
    return {
      package_name: packageName,
      screen_id: row.screen_id,
      elements: this.loadElementsForScreen(row.screen_db_id),
      source: 'cache',
      cached: true,
    }
  }

  private resolveFromUiTree(
    packageName: string,
    elementName: string,
    uiTree: ScreenUiTreeInput,
  ): ScreenUnderstandResult {
    const elements = uiTree.elements ?? []
    if (elements.length === 0) {
      return { package_name: packageName, screen_id: '', elements: [], source: 'empty', cached: false }
    }

    const screenId = `ui_tree:${hashText(uiTree.formatted || JSON.stringify(elements))}`
    const screenDbId = this.ensureScreen({ packageName, screenId })
    const stored = elements
      .map((element) => this.toUiTreeElement(screenDbId, element, elementName))
      .filter((element): element is AppMapElement => element !== null)

    const matched = this.rankElements(stored, elementName).filter((element) =>
      normalizeText(element.element_name).includes(normalizeText(elementName)),
    )

    return {
      package_name: packageName,
      screen_id: screenId,
      elements: matched,
      source: matched.length > 0 ? 'ui_tree' : 'empty',
      cached: false,
    }
  }

  private async resolveFromScreenshot(
    packageName: string,
    elementName: string,
    screenshot: ScreenScreenshotInput,
  ): Promise<ScreenUnderstandResult> {
    const image = this.readScreenshotImage(screenshot)
    if (!image) {
      return { package_name: packageName, screen_id: '', elements: [], source: 'empty', cached: false }
    }

    const processed = await preprocessScreenshotWithOpenCV({
      imageBase64: image.base64,
      mimeType: image.mimeType,
      packageName,
      elementName,
    })

    const vision = await llmService.vision({
      prompt: buildVisionPrompt(elementName),
      images: [{ data: processed.imageBase64, mime_type: processed.mimeType }],
      system: 'You extract visible UI elements from screenshots. Return JSON only.',
      temperature: 0.1,
      max_tokens: 2048,
    })

    const parsed = parseVisionElements(vision.content ?? '')
    if (parsed.length === 0) {
      return { package_name: packageName, screen_id: '', elements: [], source: 'vision', cached: false }
    }

    const screenId = `vision:${hashText(processed.imageBase64)}`
    const screenDbId = this.ensureScreen({
      packageName,
      screenId,
      screenshotPath: image.path,
      resolution: readResolution(screenshot),
    })

    const stored = parsed.map((element) => this.toVisionElement(screenDbId, element))

    for (const element of parsed) {
      try {
        storeTemplate({
          packageName,
          elementName: element.name,
          imageBase64: processed.imageBase64,
          bounds: element.bounds,
          confidence: element.confidence,
        })
      } catch {}
    }

    return {
      package_name: packageName,
      screen_id: screenId,
      elements: this.rankElements(stored, elementName),
      source: 'vision',
      cached: false,
    }
  }

  private toUiTreeElement(
    screenDbId: number,
    element: ScreenUiTreeElement,
    query: string,
  ): AppMapElement | null {
    const name = element.text?.trim() || element.content_desc?.trim() || element.resource_id?.trim() || ''
    if (!name) return null

    const className = element.class_name ?? element.class ?? 'view'
    const bounds = parseBounds(element.bounds)
    const confidence = normalizeText(name).includes(normalizeText(query)) ? 0.9 : 0.55
    const id = this.storeElement({
      screenDbId,
      name,
      type: element.clickable ? 'button' : className,
      bounds: bounds ?? emptyBounds(),
      confidence,
      source: 'ui_tree',
    })

    return {
      id,
      screen_id: screenDbId,
      element_name: name,
      element_type: element.clickable ? 'button' : className,
      bounds_json: bounds ?? emptyBounds(),
      template_path: '',
      confidence,
      hit_count: 0,
      source: 'ui_tree',
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
  }

  private toVisionElement(screenDbId: number, element: VisionElement): AppMapElement {
    const id = this.storeElement({
      screenDbId,
      name: element.name,
      type: element.type,
      bounds: element.bounds,
      confidence: element.confidence,
      source: 'vision',
    })

    return {
      id,
      screen_id: screenDbId,
      element_name: element.name,
      element_type: element.type,
      bounds_json: element.bounds,
      template_path: '',
      confidence: element.confidence,
      hit_count: 0,
      source: 'vision',
      last_seen_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    }
  }

  private ensureScreen(input: {
    packageName: string
    screenId: string
    screenshotPath?: string
    resolution?: string
  }): number {
    const db = getDb()
    const existing = db.prepare(
      'SELECT id FROM app_map_screens WHERE package_name = ? AND screen_id = ?',
    ).get(input.packageName, input.screenId) as { id: number } | undefined

    if (existing) {
      db.prepare(`
        UPDATE app_map_screens
        SET screenshot_path = COALESCE(NULLIF(?, ''), screenshot_path),
            resolution = COALESCE(NULLIF(?, ''), resolution),
            captured_at = datetime('now')
        WHERE id = ?
      `).run(input.screenshotPath ?? '', input.resolution ?? '', existing.id)
      return existing.id
    }

    const result = db.prepare(`
      INSERT INTO app_map_screens (package_name, screen_id, screenshot_path, resolution)
      VALUES (?, ?, ?, ?)
    `).run(input.packageName, input.screenId, input.screenshotPath ?? '', input.resolution ?? '')
    return Number(result.lastInsertRowid)
  }

  private storeElement(input: {
    screenDbId: number
    name: string
    type: string
    bounds: { x: number; y: number; width: number; height: number }
    source: 'vision' | 'ui_tree' | 'manual'
    confidence: number
    templatePath?: string
  }): number {
    const db = getDb()
    const result = db.prepare(`
      INSERT INTO app_map_elements (
        screen_id, element_name, element_type, bounds_json, template_path, confidence, source
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.screenDbId,
      input.name,
      input.type,
      JSON.stringify(input.bounds),
      input.templatePath ?? '',
      input.confidence,
      input.source,
    )
    return Number(result.lastInsertRowid)
  }

  private loadElementsForScreen(screenDbId: number): AppMapElement[] {
    const db = getDb()
    const rows = db.prepare(`
      SELECT * FROM app_map_elements
      WHERE screen_id = ?
      ORDER BY confidence DESC, hit_count DESC, id ASC
    `).all(screenDbId) as Array<Record<string, unknown>>
    return rows.map((row) => this.normalizeElement(row))
  }

  private rankElements(elements: AppMapElement[], query: string): AppMapElement[] {
    const normalizedQuery = normalizeText(query)
    return [...elements].sort((a, b) => {
      const aMatch = normalizeText(a.element_name).includes(normalizedQuery) ? 1 : 0
      const bMatch = normalizeText(b.element_name).includes(normalizedQuery) ? 1 : 0
      if (aMatch !== bMatch) return bMatch - aMatch
      return b.confidence - a.confidence
    })
  }

  private bumpHitCount(elementId: number): void {
    getDb().prepare(`
      UPDATE app_map_elements
      SET hit_count = hit_count + 1, last_seen_at = datetime('now')
      WHERE id = ?
    `).run(elementId)
  }

  private readScreenshotImage(screenshot: ScreenScreenshotInput): {
    base64: string
    mimeType: string
    path: string
  } | null {
    if (screenshot.synthetic) return null

    const mimeType = screenshot.mime_type ?? 'image/png'
    const raw = screenshot.data ?? screenshot.base64 ?? ''
    if (raw.startsWith('data:')) {
      return { base64: raw.slice(raw.indexOf(',') + 1), mimeType: readMimeType(raw) ?? mimeType, path: '' }
    }
    if (raw) return { base64: raw, mimeType, path: '' }

    const screenshotPath = screenshot.path ?? ''
    if (!screenshotPath || screenshotPath.startsWith('sandbox://') || !fs.existsSync(screenshotPath)) return null
    return {
      base64: fs.readFileSync(screenshotPath).toString('base64'),
      mimeType,
      path: screenshotPath,
    }
  }

  private normalizeElement(row: Record<string, unknown>): AppMapElement {
    return {
      id: Number(row.id),
      screen_id: Number(row.screen_id),
      element_name: String(row.element_name ?? ''),
      element_type: String(row.element_type ?? 'button'),
      bounds_json: parseJsonObject(row.bounds_json, emptyBounds()),
      template_path: String(row.template_path ?? ''),
      confidence: Number(row.confidence ?? 1),
      hit_count: Number(row.hit_count ?? 0),
      source: (row.source as AppMapElement['source']) ?? 'vision',
      last_seen_at: String(row.last_seen_at ?? ''),
      created_at: String(row.created_at ?? ''),
    }
  }
}

function parseBounds(bounds: unknown): { x: number; y: number; width: number; height: number } | null {
  if (Array.isArray(bounds) && bounds.length >= 4) {
    const [left, top, right, bottom] = bounds.map(Number)
    if ([left, top, right, bottom].every(Number.isFinite)) {
      return { x: left, y: top, width: right - left, height: bottom - top }
    }
  }

  if (typeof bounds === 'string') {
    const match = bounds.match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/)
    if (!match) return null
    const left = Number(match[1])
    const top = Number(match[2])
    const right = Number(match[3])
    const bottom = Number(match[4])
    return { x: left, y: top, width: right - left, height: bottom - top }
  }

  if (bounds && typeof bounds === 'object') {
    const record = bounds as Record<string, unknown>
    if ('x' in record || 'width' in record) return normalizeBounds(record)
    const left = Number(record.left ?? 0)
    const top = Number(record.top ?? 0)
    const right = Number(record.right ?? 0)
    const bottom = Number(record.bottom ?? 0)
    if ([left, top, right, bottom].every(Number.isFinite)) {
      return { x: left, y: top, width: right - left, height: bottom - top }
    }
  }

  return null
}

function parseVisionElements(raw: string): VisionElement[] {
  const parsed = parseJsonObject(stripJsonFence(raw), {}) as { elements?: unknown[] }
  if (!Array.isArray(parsed.elements)) return []

  return parsed.elements.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const bounds = parseJsonObject(record.bounds, emptyBounds())
    const name = String(record.name ?? record.text ?? '').trim()
    if (!name) return []

    return [{
      name,
      type: String(record.type ?? 'button'),
      bounds: normalizeBounds(bounds),
      confidence: clamp(Number(record.confidence ?? 0.8), 0, 1),
    }]
  })
}

function buildVisionPrompt(elementName: string): string {
  return [
    'Analyze this app screenshot as a UI map.',
    `Target element: ${elementName}`,
    'Return JSON only with this shape:',
    '{"elements":[{"name":"visible label or short description","type":"button|tab|input|text|card|icon|other","bounds":{"x":0,"y":0,"width":0,"height":0},"confidence":0.0}]}',
    'Use pixel coordinates relative to the screenshot. Include likely clickable elements even if the target is not found.',
  ].join('\n')
}

function readResolution(screenshot: ScreenScreenshotInput): string {
  if (screenshot.width && screenshot.height) return `${screenshot.width}x${screenshot.height}`
  return ''
}

function readMimeType(dataUrl: string): string | null {
  const match = dataUrl.match(/^data:([^;]+);base64,/)
  return match?.[1] ?? null
}

function stripJsonFence(raw: string): string {
  const text = raw.trim()
  if (!text.startsWith('```')) return text
  return text.replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
}

function normalizeText(value: string): string {
  return value.trim().toLowerCase()
}

function hashText(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 12)
}

function emptyBounds(): { x: number; y: number; width: number; height: number } {
  return { x: 0, y: 0, width: 0, height: 0 }
}

function normalizeBounds(value: Record<string, unknown>): { x: number; y: number; width: number; height: number } {
  return {
    x: Number(value.x ?? 0),
    y: Number(value.y ?? 0),
    width: Number(value.width ?? 0),
    height: Number(value.height ?? 0),
  }
}

function parseJsonObject<T extends Record<string, unknown>>(raw: unknown, fallback: T): T {
  if (!raw) return fallback
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as T
  if (typeof raw !== 'string') return fallback
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as T : fallback
  } catch {
    return fallback
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

export const screenUnderstandService = new ScreenUnderstandService()
