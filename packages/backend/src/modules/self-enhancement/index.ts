import { ruleEngine } from '../rule-engine/index.js'
import { skillsService } from '../skills-system/index.js'

interface RuleEngineInstance {
  addRule(rule: {
    id: number
    trigger_pattern: string
    priority: number
    enabled: boolean
    actions: Array<{ tool: string; action: string; params: Record<string, unknown>; order: number }>
  }): void
}

interface SkillsServiceInstance {
  register(skill: {
    name: string
    description: string
    prompt_template: string
    allowed_tools_json: string
    action_schema_json: string
    context_mode: string
    source: string
    skill_root: string
    enabled: boolean
  }): void
}

export interface TaskFailure {
  task_type: string
  input: string
  expected: string
  actual: string
  error: string
  trace: Array<{
    step: string
    result: string
    duration_ms: number
  }>
}

export interface ReflectionResult {
  failure_pattern: string
  root_cause: string
  suggestions: string[]
  can_generate_skill: boolean
  can_generate_rule: boolean
  confidence: number
}

const ERROR_PATTERNS: Array<{
  pattern: RegExp
  failure_pattern: string
  root_cause: string
  suggestions: string[]
  can_generate_skill: boolean
  can_generate_rule: boolean
  confidence: number
}> = [
  {
    pattern: /offline|unavailable|timeout/i,
    failure_pattern: 'device_offline',
    root_cause: '设备离线或不可达',
    suggestions: ['检查设备网络连接', '等待设备重新上线后重试', '通知用户设备离线'],
    can_generate_skill: true,
    can_generate_rule: false,
    confidence: 0.8,
  },
  {
    pattern: /no matching rule|未命中|not found.*rule/i,
    failure_pattern: 'rule_miss',
    root_cause: '缺少匹配规则',
    suggestions: ['添加对应意图的规则', '将常见意图映射到设备控制动作'],
    can_generate_skill: false,
    can_generate_rule: true,
    confidence: 0.9,
  },
  {
    pattern: /invalid.*siid|invalid.*piid|invalid.*params/i,
    failure_pattern: 'invalid_params',
    root_cause: '设备参数错误',
    suggestions: ['验证设备 Spec 中的 siid/piid', '检查参数类型和范围', '更新设备能力档案'],
    can_generate_skill: true,
    can_generate_rule: false,
    confidence: 0.7,
  },
  {
    pattern: /auth.*fail|token.*expired|未登录/i,
    failure_pattern: 'auth_failure',
    root_cause: '认证过期或失败',
    suggestions: ['刷新登录 Token', '重新扫码登录'],
    can_generate_skill: false,
    can_generate_rule: false,
    confidence: 0.95,
  },
  {
    pattern: /rate.limit|too many/i,
    failure_pattern: 'rate_limited',
    root_cause: 'API 请求频率超限',
    suggestions: ['增加请求间隔', '实现请求队列', '批量操作合并'],
    can_generate_skill: true,
    can_generate_rule: false,
    confidence: 0.85,
  },
]

export class SelfEnhancementService {
  constructor(
    private readonly ruleEngine: RuleEngineInstance = ruleEngine,
    private readonly skillsService: SkillsServiceInstance = skillsService,
  ) {}

  reflect(failure: TaskFailure): ReflectionResult {
  const errorStr = `${failure.error} ${failure.actual} ${failure.input}`.toLowerCase()

  for (const pattern of ERROR_PATTERNS) {
    if (pattern.pattern.test(errorStr)) {
      return {
        failure_pattern: pattern.failure_pattern,
        root_cause: pattern.root_cause,
        suggestions: [...pattern.suggestions],
        can_generate_skill: pattern.can_generate_skill,
        can_generate_rule: pattern.can_generate_rule,
        confidence: pattern.confidence,
      }
    }
  }

  if (failure.task_type === 'rule_match' && failure.error.includes('No matching')) {
    return {
      failure_pattern: 'rule_miss',
      root_cause: '简单意图未命中规则',
      suggestions: [`为"${failure.input}"添加规则`, '映射到设备控制动作'],
      can_generate_skill: false,
      can_generate_rule: true,
      confidence: 0.7,
    }
  }

  return {
    failure_pattern: 'unknown',
    root_cause: failure.error || '未知错误',
    suggestions: ['记录此失败以供后续分析', '检查系统日志'],
    can_generate_skill: false,
    can_generate_rule: false,
    confidence: 0.3,
  }
}

generateRule(reflection: ReflectionResult): void {
    if (!reflection.can_generate_rule || reflection.confidence < 0.5) return

    const triggerPattern = reflection.failure_pattern === 'rule_miss'
      ? reflection.suggestions[0]?.replace(/.*为[""]/, '').replace(/[""].*/, '') || 'unknown'
      : reflection.failure_pattern

    let tool = 'device_control'
    let action = 'turn_on'

    for (const suggestion of reflection.suggestions) {
      const match = suggestion.match(/调用\s+(\w+)\.(\w+)/)
      if (match) {
        tool = match[1]
        action = match[2]
        break
      }
    }

    this.ruleEngine.addRule({
      id: 0,
      trigger_pattern: triggerPattern,
      priority: Math.round(reflection.confidence * 10),
      enabled: true,
      actions: [{ tool, action, params: {}, order: 1 }],
    })
  }

  generateSkill(reflection: ReflectionResult): void {
    if (!reflection.can_generate_skill || reflection.confidence < 0.5) return

    const name = `auto_${reflection.failure_pattern}_${Date.now()}`
    const promptTemplate = reflection.suggestions.join('\n')

    this.skillsService.register({
      name,
      description: `自动生成: ${reflection.root_cause}`,
      prompt_template: promptTemplate,
      allowed_tools_json: '["mi-cli"]',
      action_schema_json: '[]',
      context_mode: 'inline',
      source: 'converted',
      skill_root: '',
      enabled: true,
    })
  }

  processFailureAndEnhance(failure: TaskFailure): void {
    const reflection = this.reflect(failure)

    if (reflection.can_generate_rule && reflection.confidence >= 0.5) {
      this.generateRule(reflection)
    }

    if (reflection.can_generate_skill && reflection.confidence >= 0.5) {
      this.generateSkill(reflection)
    }
  }
}

export const selfEnhancementService = new SelfEnhancementService()
