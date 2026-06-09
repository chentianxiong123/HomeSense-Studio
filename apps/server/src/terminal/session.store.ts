import type { Subscription } from 'rxjs'
import { randomUUID } from 'crypto'
import { createProtocol, TerminalProtocol, ProtocolTarget, ProtocolKind } from './protocols/protocol.interface'

export type SessionInfo = {
  id: string
  kind: ProtocolKind
  label: string
  target: ProtocolTarget
  cols: number
  rows: number
  startedAt: number
}

const IDLE_TIMEOUT_MS = 5 * 60 * 1000
const HISTORY_MAX_LINES = 1000
const HISTORY_MAX_BYTES = 512 * 1024

type SocketSender = (payload: string) => void
type SessionExit = { code: number; signal?: string }

class ManagedSession {
  readonly id: string
  readonly info: SessionInfo
  readonly protocol: TerminalProtocol
  private sockets = new Set<SocketSender>()
  private idleTimer: NodeJS.Timeout | null = null
  private outputSubscription: Subscription
  private exitSubscription: Subscription
  private history = ''
  private closed = false

  constructor(
    id: string,
    info: SessionInfo,
    protocol: TerminalProtocol,
    private readonly onClosed: (id: string) => void,
  ) {
    this.id = id
    this.info = info
    this.protocol = protocol

    this.outputSubscription = this.protocol.output$.subscribe((d) => this.handleOutput(d))
    this.exitSubscription = this.protocol.exit$.subscribe((e) => this.close(e))
  }

  attachSocket(send: SocketSender) {
    if (this.closed) throw new Error(`session is closed: ${this.id}`)
    this.sockets.add(send)
    this.clearIdleTimer()
    send(JSON.stringify({
      type: 'session_opened',
      data: {
        session_id: this.id,
        kind: this.info.kind,
        label: this.info.label,
        cols: this.info.cols,
        rows: this.info.rows,
        started_at: this.info.startedAt,
      },
    }))
    if (this.history) {
      send(JSON.stringify({ type: 'history', data: this.history }))
    }
  }

  detachSocket(send: SocketSender) {
    this.sockets.delete(send)
    this.scheduleIdleCleanup()
  }

  terminate(reason = 'terminated') {
    this.close({ code: 0, signal: reason }, true)
  }

  dispose(reason = 'disposed') {
    this.close({ code: 0, signal: reason }, true)
  }

  resize(cols: number, rows: number) {
    if (this.closed) return
    this.info.cols = cols
    this.info.rows = rows
    this.protocol.resize(cols, rows)
  }

  write(data: string) {
    if (this.closed) return
    this.protocol.write(data)
  }

  private handleOutput(data: string) {
    if (this.closed) return
    this.history = trimHistory(`${this.history}${data}`)
    this.broadcast({ type: 'stdout', data })
  }

  private close(exit: SessionExit, killProtocol = false) {
    if (this.closed) return
    this.closed = true
    this.clearIdleTimer()
    if (killProtocol) {
      try { this.protocol.kill() } catch { /* ignore */ }
    }
    this.broadcast({ type: 'exit', data: { code: exit.code, signal: exit.signal } })
    this.sockets.clear()
    this.outputSubscription.unsubscribe()
    this.exitSubscription.unsubscribe()
    this.onClosed(this.id)
  }

  private scheduleIdleCleanup() {
    if (this.closed || this.sockets.size > 0 || this.idleTimer) return
    this.idleTimer = setTimeout(() => this.dispose('idle timeout'), IDLE_TIMEOUT_MS)
    this.idleTimer.unref?.()
  }

  private clearIdleTimer() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer)
      this.idleTimer = null
    }
  }

  private broadcast(message: Record<string, unknown>) {
    const payload = JSON.stringify(message)
    for (const send of this.sockets) {
      try { send(payload) } catch { /* ignore */ }
    }
  }
}

export const SessionStore = {
  sessions: new Map<string, ManagedSession>(),

  async create(target: ProtocolTarget, label: string, cols: number, rows: number): Promise<ManagedSession> {
    const id = randomUUID()
    const protocol = createProtocol(target.kind)
    const info: SessionInfo = { id, kind: target.kind, label, target, cols, rows, startedAt: Date.now() }
    const session = new ManagedSession(id, info, protocol, (closedId) => {
      if (SessionStore.sessions.get(closedId) === session) {
        SessionStore.sessions.delete(closedId)
      }
    })
    SessionStore.sessions.set(id, session)

    try {
      await protocol.start({
        sessionId: id,
        kind: target.kind,
        label,
        target,
        cols,
        rows,
      })
    } catch (err) {
      session.dispose('start failed')
      throw err
    }

    return session
  },

  get(id: string): ManagedSession | undefined {
    return SessionStore.sessions.get(id)
  },

  remove(id: string) {
    const session = SessionStore.sessions.get(id)
    if (!session) return
    session.terminate()
  },

  terminate(id: string, reason = 'terminated'): boolean {
    const session = SessionStore.sessions.get(id)
    if (!session) return false
    session.terminate(reason)
    return true
  },

  shutdownAll() {
    for (const session of Array.from(SessionStore.sessions.values())) {
      session.dispose('server shutdown')
    }
  },
}

function trimHistory(value: string): string {
  let trimmed = value.length > HISTORY_MAX_BYTES ? value.slice(-HISTORY_MAX_BYTES) : value
  let newlineCount = 0
  for (let i = trimmed.length - 1; i >= 0; i -= 1) {
    if (trimmed.charCodeAt(i) !== 10) continue
    newlineCount += 1
    if (newlineCount > HISTORY_MAX_LINES) {
      trimmed = trimmed.slice(i + 1)
      break
    }
  }
  return trimmed
}
