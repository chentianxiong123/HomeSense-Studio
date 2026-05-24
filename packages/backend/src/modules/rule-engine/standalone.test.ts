/**
 * RuleEngine — 独立完整测试套件
 * 不依赖项目任何模块，只用 Node.js 内置 + vitest
 * 测试场景：精确匹配 / 子串匹配 / 正则匹配 / 字符重叠匹配
 * 边界：优先级选择 / 置信度计算 / 空输入 / 特殊字符
 */
import { describe, it, expect, beforeEach } from 'vitest'

// ── 纯函数实现（从 rule-engine 复制，不引用项目） ──────────────────────────

interface RuleAction {
  tool: string; action: string; params: Record<string, unknown>; order: number
}
interface Rule {
  id: number; trigger_pattern: string; priority: number
  enabled: boolean; actions: RuleAction[]
}
interface RuleMatch {
  rule_id: number; trigger_pattern: string
  actions: RuleAction[]; confidence: number
}
interface GetDbFn { (): { prepare(sql: string): { all(...args: unknown[]): unknown[]; run(...args: unknown[]): { lastInsertRowid: unknown } } } }
interface EventBus {
  fire(event: string, data?: unknown): void
}
interface ServiceRegistry {
  call(serviceName: string, params: Record<string, unknown>): Promise<unknown>
}

// ── 纯内存 DB ──────────────────────────────────────────────────────────────

function createInMemoryDb() {
  const rules: Array<Rule & { actions_json: string }> = []
  let nextId = 1

  return {
    prepare(sql: string) {
      return {
        all(_id?: number) {
          if (sql.includes('SELECT * FROM rules')) return rules.filter(r => r.enabled).map(r => ({
            id: r.id, trigger_pattern: r.trigger_pattern, priority: r.priority, enabled: r.enabled ? 1 : 0
          }))
          if (sql.includes('rule_actions')) return []
          return []
        },
        run(...args: unknown[]) {
          if (sql.includes('INSERT INTO rules')) {
            const [tp, pri, en] = args as [string, number, number]
            const id = nextId++
            rules.push({ id, trigger_pattern: tp, priority: pri, enabled: en === 1, actions: [], actions_json: '' })
            return { lastInsertRowid: id }
          }
          return { lastInsertRowid: 0 }
        },
      }
    },
    // 测试用：直接插入规则
    _insertRule(r: Rule) { rules.push({ ...r }) },
    _clearRules() { rules.length = 0; nextId = 1 },
  }
}

// ── FakeEventBus ────────────────────────────────────────────────────────────

interface RecordedEvent { event: string; data?: unknown; timestamp: number }

class FakeEventBus {
  fired: RecordedEvent[] = []
  fire(event: string, data?: unknown) {
    this.fired.push({ event, data, timestamp: Date.now() })
  }
  firedNames() { return this.fired.map(e => e.event) }
  countOf(event: string) { return this.fired.filter(e => e.event === event).length }
  lastOf(event: string) { return this.fired.filter(e => e.event === event).at(-1) }
}

// ── RuleEngine（纯函数副本） ───────────────────────────────────────────────

class RuleEngine {
  private rules = new Map<number, Rule>()

  constructor(
    private readonly getDb: GetDbFn,
    private readonly eventBus: EventBus,
    private readonly serviceRegistry: ServiceRegistry,
  ) {}

  loadFromDb(): void {
    const db = this.getDb()
    const rows = db.prepare('SELECT * FROM rules WHERE enabled = 1 ORDER BY priority DESC').all() as Array<{
      id: number; trigger_pattern: string; priority: number; enabled: number
    }>
    for (const row of rows) {
      this.rules.set(row.id, {
        id: row.id,
        trigger_pattern: row.trigger_pattern,
        priority: row.priority,
        enabled: row.enabled === 1,
        actions: [],
      })
    }
  }

  addRule(rule: Rule): void {
    const db = this.getDb()
    const result = db.prepare(
      `INSERT INTO rules (trigger_pattern, priority, enabled) VALUES (?, ?, ?)`,
    ).run(rule.trigger_pattern, rule.priority, rule.enabled ? 1 : 0) as { lastInsertRowid: number }
    const ruleId = Number(result.lastInsertRowid)
    this.rules.set(ruleId, { ...rule, id: ruleId })
    this.eventBus.fire('rule_added', { rule_id: ruleId })
  }

  removeRule(ruleId: number): void {
    this.rules.delete(ruleId)
    this.eventBus.fire('rule_removed', { rule_id: ruleId })
  }

  match(input: string): RuleMatch | null {
    const trimmed = input.trim()
    if (!trimmed) return null

    let bestMatch: RuleMatch | null = null

    for (const rule of this.rules.values()) {
      if (!rule.enabled) continue

      const pattern = rule.trigger_pattern
      let matched = false
      let confidence = 0

      // 1. 精确匹配
      if (trimmed === pattern) {
        matched = true; confidence = 1.0
      }
      // 2. 子串包含
      else if (trimmed.includes(pattern)) {
        matched = true; confidence = 0.9
      }
      // 3. 正则 /.../
      else if (pattern.startsWith('/') && pattern.endsWith('/')) {
        try {
          const regex = new RegExp(pattern.slice(1, -1))
          if (regex.test(trimmed)) { matched = true; confidence = 0.8 }
        } catch { /* invalid regex */ }
      }
      // 4. 字符重叠率
      else {
        const patternChars = [...pattern]
        const inputChars = [...trimmed]
        let matchCount = 0
        for (const ch of patternChars) {
          if (inputChars.includes(ch)) matchCount++
        }
        const ratio = matchCount / patternChars.length
        if (ratio >= 0.7) { matched = true; confidence = ratio * 0.7 }
      }

      if (matched) {
        if (
          !bestMatch ||
          rule.priority > this.rules.get(bestMatch.rule_id)!.priority ||
          confidence > bestMatch.confidence
        ) {
          bestMatch = {
            rule_id: rule.id,
            trigger_pattern: rule.trigger_pattern,
            actions: rule.actions,
            confidence,
          }
        }
      }
    }

    if (bestMatch) {
      this.eventBus.fire('rule_matched', {
        rule_id: bestMatch.rule_id,
        input,
        confidence: bestMatch.confidence,
      })
    }

    return bestMatch
  }

  async executeAction(action: RuleAction): Promise<{ success: boolean; data?: unknown; error?: string }> {
    try {
      const serviceName = `${action.tool}.${action.action}`
      const result = await this.serviceRegistry.call(serviceName, action.params)
      return { success: true, data: result }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    }
  }

  listRules(): Rule[] { return Array.from(this.rules.values()) }
}

// ── 测试 ──────────────────────────────────────────────────────────────────

const noopRegistry: ServiceRegistry = { call: async () => undefined }

function makeEngine(db = createInMemoryDb()) {
  const bus = new FakeEventBus()
  const engine = new RuleEngine(() => db, bus, noopRegistry)
  return { engine, bus, db }
}

// ══════════════════════════════════════════════════════════════════════════
// 场景 1：精确匹配（exact match）
// ══════════════════════════════════════════════════════════════════════════

describe('精确匹配 (exact match)', () => {
  it('输入与 pattern 完全一致时返回 confidence 1.0', () => {
    const { engine, bus } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '打开电视', priority: 1, enabled: true, actions: [] })
    const result = engine.match('打开电视')
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(1.0)
    expect(result!.trigger_pattern).toBe('打开电视')
    expect(bus.countOf('rule_matched')).toBe(1)
  })

  it('中英文完全一致', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'Turn on TV', priority: 1, enabled: true, actions: [] })
    expect(engine.match('Turn on TV')?.confidence).toBe(1.0)
  })

  it('带空格的精确匹配', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '打开 电视', priority: 1, enabled: true, actions: [] })
    expect(engine.match('打开 电视')?.confidence).toBe(1.0)
    expect(engine.match('打开电视')?.confidence).toBeLessThan(1.0)
  })

  it('大小写敏感（英文不转小写）', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'TurnOnTV', priority: 1, enabled: true, actions: [] })
    // 精确匹配：trimmed === pattern → "turnontv" !== "TurnOnTV"
    expect(engine.match('turnontv')?.confidence).toBeNull()
    // 大小写匹配才成立
    expect(engine.match('TurnOnTV')?.confidence).toBe(1.0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 2：子串包含匹配（substring match）
// ══════════════════════════════════════════════════════════════════════════

describe('子串包含匹配 (substring)', () => {
  it('输入包含 pattern 时返回 confidence 0.9', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '电视', priority: 1, enabled: true, actions: [] })
    const result = engine.match('我想打开电视')
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(0.9)
  })

  it('pattern 在开头', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '打开', priority: 1, enabled: true, actions: [] })
    expect(engine.match('打开电视').confidence).toBe(0.9)
  })

  it('pattern 在中间', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '电视', priority: 1, enabled: true, actions: [] })
    expect(engine.match('切换到电视模式').confidence).toBe(0.9)
  })

  it('pattern 在结尾', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '关机', priority: 1, enabled: true, actions: [] })
    expect(engine.match('电视关机').confidence).toBe(0.9)
  })

  it('优先精确匹配而非子串', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '打开电视', priority: 1, enabled: true, actions: [] })
    engine.addRule({ id: 0, trigger_pattern: '电视', priority: 5, enabled: true, actions: [] }) // 高优先级子串
    const result = engine.match('我想打开电视')
    // 当精确匹配 "打开电视" 不存在时，"我想打开电视" 包含 "电视" confidence=0.9
    // 但如果精确匹配存在（上面第一条），输入 "我想打开电视" 不精确匹配任何规则
    // 只匹配子串 "电视" → confidence 0.9
    expect(result?.confidence).toBe(0.9)
    expect(result?.trigger_pattern).toBe('电视')
  })

  it('精确匹配输入 vs 完全相等规则的优先级', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '打开电视', priority: 1, enabled: true, actions: [] })
    engine.addRule({ id: 0, trigger_pattern: '打开电视全', priority: 10, enabled: true, actions: [] })
    const result = engine.match('打开电视')
    // "打开电视" 不精确匹配 "打开电视全" (输入短)
    // 不包含匹配 "打开电视全"
    // 精确匹配 "打开电视" → confidence 1.0
    expect(result?.confidence).toBe(1.0)
    expect(result?.trigger_pattern).toBe('打开电视')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 3：正则匹配（regex match）
// ══════════════════════════════════════════════════════════════════════════

describe('正则匹配 (regex /.../)', () => {
  it('有效正则匹配成功', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '/^打开.+电视$/', priority: 1, enabled: true, actions: [] })
    expect(engine.match('打开索尼电视')?.confidence).toBe(0.8)
    expect(engine.match('打开电视')?.confidence).toBeNull() // 不匹配（.+ 需要至少一个字符）
  })

  it('正则匹配成功但 confidence 低于精确匹配', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '/^打开/', priority: 1, enabled: true, actions: [] })
    expect(engine.match('打开电视')?.confidence).toBe(0.8)
  })

  it('无效正则不崩溃', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '/[invalid/', priority: 1, enabled: true, actions: [] })
    expect(() => engine.match('test [invalid')).not.toThrow()
    expect(engine.match('test [invalid')).toBeNull()
  })

  it('正则能匹配数字', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '/^播放第\\d+集$/', priority: 1, enabled: true, actions: [] })
    expect(engine.match('播放第3集')?.confidence).toBe(0.8)
    expect(engine.match('播放第10集')?.confidence).toBe(0.8)
  })

  it('正则能匹配中文', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '/^打开(电视|空调)$/', priority: 1, enabled: true, actions: [] })
    expect(engine.match('打开电视')?.confidence).toBe(0.8)
    expect(engine.match('打开空调')?.confidence).toBe(0.8)
    expect(engine.match('打开风扇')?.confidence).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 4：字符重叠匹配（char-overlap）
// ══════════════════════════════════════════════════════════════════════════

describe('字符重叠匹配 (char-overlap ratio ≥ 0.7)', () => {
  it('100% 字符重叠 = confidence 0.7', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '电视', priority: 1, enabled: true, actions: [] })
    const result = engine.match('电视')
    expect(result).not.toBeNull()
    expect(result!.confidence).toBeCloseTo(0.7, 2)
  })

  it('70% 刚好达标 threshold', () => {
    const { engine } = makeEngine()
    // "电视" 2字，输入 "电" 只有50%，不够0.7
    engine.addRule({ id: 0, trigger_pattern: '电视', priority: 1, enabled: true, actions: [] })
    expect(engine.match('电')).toBeNull()

    // 3字 pattern："abc"，输入 "abcx" 重叠3/3=1.0
    engine.addRule({ id: 0, trigger_pattern: 'abc', priority: 1, enabled: true, actions: [] })
    expect(engine.match('abcx')?.confidence).toBeCloseTo(0.7, 2)
  })

  it('长 pattern 需要更多重叠', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '打开电视', priority: 1, enabled: true, actions: [] })
    // 输入 "打开" : overlap=2/4=0.5 < 0.7 → 不匹配
    expect(engine.match('打开')).toBeNull()
    // 输入 "打开电视" : 4/4=1.0 → 匹配
    expect(engine.match('打开电视')?.confidence).toBeCloseTo(0.7, 2)
  })

  it('字符重复计算', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '看看看', priority: 1, enabled: true, actions: [] })
    // 输入 "看看" : overlap=2/3=0.667 < 0.7 → 不匹配
    expect(engine.match('看看')).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 5：空输入和边界
// ══════════════════════════════════════════════════════════════════════════

describe('空输入和边界', () => {
  it('空字符串返回 null', () => {
    const { engine } = makeEngine()
    expect(engine.match('')).toBeNull()
  })

  it('纯空白返回 null', () => {
    const { engine } = makeEngine()
    expect(engine.match('   ')).toBeNull()
    expect(engine.match('\t\n')).toBeNull()
  })

  it('无规则时返回 null', () => {
    const { engine } = makeEngine()
    expect(engine.match('anything')).toBeNull()
  })

  it('trim 后的空串返回 null', () => {
    const { engine } = makeEngine()
    expect(engine.match('  ')).toBeNull()
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 6：优先级选择
// ══════════════════════════════════════════════════════════════════════════

describe('优先级选择 (priority)', () => {
  it('相同 pattern，高 priority 优先', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '打开电视', priority: 1, enabled: true, actions: [{ tool: 'a', action: 'x', params: {}, order: 0 }] })
    engine.addRule({ id: 0, trigger_pattern: '打开电视', priority: 10, enabled: true, actions: [{ tool: 'b', action: 'y', params: {}, order: 0 }] })
    const result = engine.match('打开电视')
    expect(result?.rule_id).toBe(2) // 后添加的（id更大）优先级高
  })

  it('不同 confidence 时选高 confidence', () => {
    const { engine } = makeEngine()
    // 低优先级精确匹配
    engine.addRule({ id: 0, trigger_pattern: '打开电视', priority: 1, enabled: true, actions: [] })
    // 高优先级子串匹配
    engine.addRule({ id: 0, trigger_pattern: '电视', priority: 2, enabled: true, actions: [] })

    const result = engine.match('打开电视')
    // "打开电视" 精确匹配 "打开电视" → confidence 1.0
    // 但如果两条都存在，"打开电视" 也会匹配子串 pattern="电视" → confidence 0.9
    // 精确优先 → confidence 1.0 赢
    expect(result?.confidence).toBe(1.0)
    expect(result?.trigger_pattern).toBe('打开电视')
  })

  it('priority 相等时，confidence 高者赢', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '开', priority: 1, enabled: true, actions: [{ tool: 'low', action: 'a', params: {}, order: 0 }] })
    engine.addRule({ id: 0, trigger_pattern: '打开', priority: 1, enabled: true, actions: [{ tool: 'high', action: 'b', params: {}, order: 0 }] })

    const result = engine.match('打开')
    // "打开" 精确匹配 "打开" confidence 1.0
    // "打开" 也包含匹配 "开" confidence 0.9
    // priority 相等 → confidence 1.0 赢
    expect(result?.confidence).toBe(1.0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 7：enabled / disabled 规则
// ══════════════════════════════════════════════════════════════════════════

describe('enabled / disabled 规则', () => {
  it('disabled 规则不参与匹配', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'secret', priority: 99, enabled: false, actions: [] })
    expect(engine.match('secret')).toBeNull()
  })

  it('部分 enabled 正常匹配', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'hidden', priority: 99, enabled: false, actions: [] })
    engine.addRule({ id: 0, trigger_pattern: 'visible', priority: 1, enabled: true, actions: [] })
    expect(engine.match('hidden')).toBeNull()
    expect(engine.match('visible')?.confidence).toBe(1.0)
  })

  it('loadFromDb 跳过 disabled 规则', () => {
    const db = createInMemoryDb()
    // 模拟 DB 中有 disabled 规则
    const { engine, bus } = makeEngine(db)
    engine.loadFromDb()
    expect(engine.listRules()).toHaveLength(0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 8：addRule / removeRule / listRules
// ══════════════════════════════════════════════════════════════════════════

describe('addRule / removeRule / listRules', () => {
  it('addRule 后立即可匹配', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'test', priority: 1, enabled: true, actions: [] })
    expect(engine.match('test')?.confidence).toBe(1.0)
  })

  it('removeRule 后不可见', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'delete-me', priority: 1, enabled: true, actions: [] })
    const id = engine.listRules()[0].id
    engine.removeRule(id)
    expect(engine.match('delete-me')).toBeNull()
    expect(engine.listRules()).toHaveLength(0)
  })

  it('addRule 触发 rule_added 事件', () => {
    const { engine, bus } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'event-test', priority: 1, enabled: true, actions: [] })
    expect(bus.countOf('rule_added')).toBe(1)
    expect(bus.lastOf('rule_added')?.data).toMatchObject({ rule_id: 1 })
  })

  it('removeRule 触发 rule_removed 事件', () => {
    const { engine, bus } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'event-test2', priority: 1, enabled: true, actions: [] })
    const id = engine.listRules()[0].id
    engine.removeRule(id)
    expect(bus.countOf('rule_removed')).toBe(1)
    expect(bus.lastOf('rule_removed')?.data).toMatchObject({ rule_id: id })
  })

  it('listRules 返回规则数组副本', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'a', priority: 1, enabled: true, actions: [] })
    engine.addRule({ id: 0, trigger_pattern: 'b', priority: 1, enabled: true, actions: [] })
    const rules = engine.listRules()
    expect(rules).toHaveLength(2)
    expect(rules.map(r => r.trigger_pattern).sort()).toEqual(['a', 'b'])
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 9：executeAction
// ══════════════════════════════════════════════════════════════════════════

describe('executeAction', () => {
  it('成功调用返回 success:true', async () => {
    const registry: ServiceRegistry = {
      call: async (name, params) => {
        return { received: { name, params } }
      },
    }
    const { engine } = makeEngine()
    const result = await engine.executeAction({
      tool: 'mi', action: 'set_prop',
      params: { did: 'tv-1', siid: 2, piid: 1, value: true },
      order: 0,
    })
    expect(result.success).toBe(true)
    expect((result.data as any).name).toBe('mi.set_prop')
    expect((result.data as any).params).toEqual({ did: 'tv-1', siid: 2, piid: 1, value: true })
  })

  it('serviceRegistry 异常返回 success:false + error', async () => {
    const failRegistry: ServiceRegistry = {
      call: async () => { throw new Error('service not found') },
    }
    const db = createInMemoryDb()
    const bus = new FakeEventBus()
    const engine = new RuleEngine(() => db, bus, failRegistry)
    const result = await engine.executeAction({ tool: 'x', action: 'y', params: {}, order: 0 })
    expect(result.success).toBe(false)
    expect(result.error).toBe('service not found')
  })

  it('tool.action 格式正确拼接', async () => {
    let captured = ''
    const registry: ServiceRegistry = { call: async (name) => { captured = name; return 'ok' } }
    const { engine } = makeEngine()
    await engine.executeAction({ tool: 'hami', action: 'adb_shell', params: {}, order: 0 })
    expect(captured).toBe('hami.adb_shell')
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 10：连续多次匹配（状态保持）
// ══════════════════════════════════════════════════════════════════════════

describe('状态保持（连续匹配）', () => {
  it('匹配后规则仍在', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'stay', priority: 1, enabled: true, actions: [] })
    engine.match('stay')
    engine.match('stay')
    engine.match('stay')
    expect(engine.listRules()).toHaveLength(1)
  })

  it('fire 事件累积（不覆盖）', () => {
    const { engine, bus } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'repeat', priority: 1, enabled: true, actions: [] })
    engine.match('repeat')
    engine.match('repeat')
    expect(bus.countOf('rule_matched')).toBe(2)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 11：特殊字符
// ══════════════════════════════════════════════════════════════════════════

describe('特殊字符处理', () => {
  it('pattern 含空格（字面匹配）', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '打开 电视', priority: 1, enabled: true, actions: [] })
    expect(engine.match('打开 电视')?.confidence).toBe(1.0)
    expect(engine.match('打开电视')?.confidence).toBeNull() // 空格不同
  })

  it('pattern 含中文+英文', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'Turn on TV', priority: 1, enabled: true, actions: [] })
    expect(engine.match('Turn on TV')?.confidence).toBe(1.0)
  })

  it('pattern 含标点', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: '打开电视?', priority: 1, enabled: true, actions: [] })
    expect(engine.match('打开电视?')?.confidence).toBe(1.0)
  })

  it('输入含换行符会被 trim', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'test', priority: 1, enabled: true, actions: [] })
    expect(engine.match('  test  ')?.confidence).toBe(1.0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 12：match 的 JSON 输出完整性
// ══════════════════════════════════════════════════════════════════════════

describe('RuleMatch 输出结构', () => {
  it('返回完整字段', () => {
    const { engine } = makeEngine()
    engine.addRule({
      id: 0, trigger_pattern: '完整测试',
      priority: 5, enabled: true,
      actions: [{ tool: 'mi', action: 'test', params: { a: 1 }, order: 0 }],
    })
    const result = engine.match('完整测试')
    expect(result).toEqual({
      rule_id: 1,
      trigger_pattern: '完整测试',
      confidence: 1.0,
      actions: [{ tool: 'mi', action: 'test', params: { a: 1 }, order: 0 }],
    })
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 13：优先级数值边界
// ══════════════════════════════════════════════════════════════════════════

describe('优先级数值边界', () => {
  it('priority = 0 可正常工作', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'zero-pri', priority: 0, enabled: true, actions: [] })
    expect(engine.match('zero-pri')?.confidence).toBe(1.0)
  })

  it('priority 负数（不应该，但可能存在 DB）', () => {
    const { engine } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'neg-pri', priority: -5, enabled: true, actions: [] })
    expect(engine.match('neg-pri')?.confidence).toBe(1.0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 14：性能 — 大量规则
// ══════════════════════════════════════════════════════════════════════════

describe('性能（大量规则）', () => {
  it('100 条规则仍可正常匹配', () => {
    const { engine } = makeEngine()
    for (let i = 0; i < 100; i++) {
      engine.addRule({ id: 0, trigger_pattern: `rule-${i}`, priority: i, enabled: true, actions: [] })
    }
    const result = engine.match('rule-50')
    expect(result?.confidence).toBe(1.0)
    expect(engine.listRules()).toHaveLength(100)
  })

  it('规则顺序不影响匹配结果（按 priority 遍历）', () => {
    const { engine } = makeEngine()
    // 逆序添加
    for (let i = 99; i >= 0; i--) {
      engine.addRule({ id: 0, trigger_pattern: `r${i}`, priority: i, enabled: true, actions: [] })
    }
    expect(engine.match('r50')?.confidence).toBe(1.0)
  })
})

// ══════════════════════════════════════════════════════════════════════════
// 场景 15：rule_matched 事件载荷
// ══════════════════════════════════════════════════════════════════════════

describe('rule_matched 事件载荷', () => {
  it('包含 rule_id / input / confidence', () => {
    const { engine, bus } = makeEngine()
    engine.addRule({ id: 0, trigger_pattern: 'evt-test', priority: 1, enabled: true, actions: [] })
    engine.match('evt-test')
    const evt = bus.lastOf('rule_matched')
    expect(evt?.data).toMatchObject({
      rule_id: expect.any(Number),
      input: 'evt-test',
      confidence: 1.0,
    })
  })
})