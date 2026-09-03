export interface L1ReflexPolicyRule {
  id: string
  label: string
  description: string
  examples: string[]
}

export interface L1ReflexPolicy {
  max_compact_length: number
  blocked_markers: L1ReflexPolicyRule[]
  blocked_punctuation: L1ReflexPolicyRule[]
  blocked_patterns: L1ReflexPolicyRule[]
  allow_summary: string
}

export const L1_REFLEX_MAX_COMPACT_LENGTH = 10

export const L1_REFLEX_BLOCKED_MARKERS: L1ReflexPolicyRule[] = [
  {
    id: 'negation-bu',
    label: '不',
    description: 'Any input containing 不 is excluded from L1 direct reflex execution.',
    examples: ['不要打开电视', '不用真的执行', '我不想操作设备'],
  },
]

export const L1_REFLEX_BLOCKED_PUNCTUATION: L1ReflexPolicyRule[] = [
  {
    id: 'question',
    label: '?？',
    description: 'Question-like input is handled by the model instead of L1.',
    examples: ['打开电视吗？', '怎么开电视？'],
  },
  {
    id: 'complex-punctuation',
    label: '，,。；;：:、',
    description: 'Sentence punctuation usually means the utterance is explanatory, conditional, or multi-step.',
    examples: ['打开电视，然后播放B站', '我想看电视，但先别操作'],
  },
]

export const L1_REFLEX_BLOCKED_PATTERNS: L1ReflexPolicyRule[] = [
  { id: 'want', label: '我想', description: 'Desire statements are not immediate reflex commands.', examples: ['我想打开电视'] },
  { id: 'inspect', label: '帮我看看', description: 'Inspection requests need model interpretation.', examples: ['帮我看看电视状态'] },
  { id: 'first', label: '先', description: 'Staged requests should go through L3 planning.', examples: ['先别操作设备'] },
  { id: 'only', label: '只是', description: 'Explanatory-only requests should not execute.', examples: ['我只是想了解怎么开电视'] },
  { id: 'learn', label: '了解 / 解释 / 咨询 / 讨论', description: 'Learning and explanation intents are model conversation.', examples: ['解释一下怎么开电视'] },
  { id: 'condition', label: '如果 / 假如', description: 'Conditional requests are not L1 reflexes.', examples: ['如果我要看电视你会怎么做'] },
  { id: 'turn', label: '但是 / 但 / 然后 / 或者', description: 'Turn or conjunction words indicate a complex sentence.', examples: ['打开电视，然后播放B站'] },
  { id: 'can', label: '能不能 / 可不可以 / 可以吗 / 会不会', description: 'Capability questions need confirmation or explanation.', examples: ['能不能打开电视'] },
  { id: 'how', label: '怎么 / 如何 / 为什么 / 什么', description: 'How/why/what questions should go to L3.', examples: ['怎么打开电视'] },
  { id: 'confirm', label: '确认一下', description: 'Confirmation language should not be treated as direct execution.', examples: ['帮我确认一下要怎么做'] },
]

export const L1_REFLEX_POLICY: L1ReflexPolicy = {
  max_compact_length: L1_REFLEX_MAX_COMPACT_LENGTH,
  blocked_markers: L1_REFLEX_BLOCKED_MARKERS,
  blocked_punctuation: L1_REFLEX_BLOCKED_PUNCTUATION,
  blocked_patterns: L1_REFLEX_BLOCKED_PATTERNS,
  allow_summary: 'Only short, imperative, non-question, non-negated utterances can enter L1.',
}

const blockedPatternRegexes = [
  /我想/,
  /帮我看看/,
  /先/,
  /只是/,
  /了解/,
  /解释/,
  /咨询/,
  /讨论/,
  /如果/,
  /假如/,
  /但是/,
  /但/,
  /然后/,
  /或者/,
  /能不能/,
  /可不可以/,
  /可以吗/,
  /会不会/,
  /怎么/,
  /如何/,
  /为什么/,
  /什么/,
  /确认一下/,
]

export function shouldAttemptL1Reflex(input: string): { allowed: boolean; reason: string } {
  const text = input.trim()
  const compact = text.replace(/\s+/g, '')

  if (!compact) return { allowed: false, reason: 'empty input' }
  if (compact.includes('不')) return { allowed: false, reason: 'contains negation marker 不' }
  if (/[?？]/.test(compact)) return { allowed: false, reason: 'question-like input is not a reflex command' }
  if (/[，,。；;：:、]/.test(compact)) return { allowed: false, reason: 'complex sentence punctuation is not allowed in L1' }
  if (compact.length > L1_REFLEX_MAX_COMPACT_LENGTH) return { allowed: false, reason: 'input is too long for L1 reflex' }
  if (blockedPatternRegexes.some((pattern) => pattern.test(compact))) {
    return { allowed: false, reason: 'complex or explanatory intent is not allowed in L1' }
  }

  return { allowed: true, reason: 'short imperative reflex candidate' }
}
