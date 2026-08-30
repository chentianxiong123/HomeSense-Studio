export type ApprovalDecision = 'approved' | 'denied' | 'timeout'

export interface ApprovalRecord {
  id: string
  turn_id: string
  reason: string
  payload: unknown
  created_at: number
  decision?: ApprovalDecision
  resolved_at?: number
}

const DEFAULT_TIMEOUT_MS = 60_000

class ApprovalRegistry {
  private records = new Map<string, ApprovalRecord>()
  private waiters = new Map<string, (decision: ApprovalDecision) => void>()

  create(turnId: string, reason: string, payload: unknown): ApprovalRecord {
    const id = `approval_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const record: ApprovalRecord = {
      id,
      turn_id: turnId,
      reason,
      payload,
      created_at: Date.now(),
    }
    this.records.set(id, record)
    return record
  }

  async wait(id: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<ApprovalDecision> {
    const record = this.records.get(id)
    if (!record) return 'denied'
    if (record.decision) return record.decision

    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(id)
        const stored = this.records.get(id)
        if (stored && !stored.decision) {
          stored.decision = 'timeout'
          stored.resolved_at = Date.now()
        }
        resolve('timeout')
      }, timeoutMs)

      this.waiters.set(id, (decision) => {
        clearTimeout(timer)
        resolve(decision)
      })
    })
  }

  resolve(id: string, decision: ApprovalDecision): boolean {
    const record = this.records.get(id)
    if (!record) return false
    if (record.decision) return false
    record.decision = decision
    record.resolved_at = Date.now()
    const waiter = this.waiters.get(id)
    if (waiter) {
      this.waiters.delete(id)
      waiter(decision)
    }
    return true
  }

  get(id: string): ApprovalRecord | undefined {
    return this.records.get(id)
  }

  list(): ApprovalRecord[] {
    return Array.from(this.records.values()).sort((a, b) => b.created_at - a.created_at)
  }

  cleanup(olderThanMs: number = 3600_000): void {
    const now = Date.now()
    for (const [id, record] of this.records) {
      if (record.resolved_at && now - record.resolved_at > olderThanMs) {
        this.records.delete(id)
      }
    }
  }
}

export const approvalRegistry = new ApprovalRegistry()

const HIGH_RISK_CLI_ACTIONS = new Set(['set_prop', 'run_action', 'install', 'uninstall'])

export function isHighRiskCliCall(cliName: string, action: string): boolean {
  if (HIGH_RISK_CLI_ACTIONS.has(action)) return true
  if (cliName === 'adb-cli' && (action === 'launch_app' || action === 'install_apk')) return true
  return false
}
