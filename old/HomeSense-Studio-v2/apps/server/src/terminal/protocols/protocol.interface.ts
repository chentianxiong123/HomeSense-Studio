import { Subject, Observable } from 'rxjs'

export type ProtocolKind = 'local' | 'ssh' | 'adb'

export type ProtocolTarget =
  | { kind: 'local'; shell?: string; cwd?: string }
  | { kind: 'ssh'; host: string; port?: number; user: string; auth: 'password' | 'key'; password?: string; keyName?: string }
  | { kind: 'adb'; serial: string; command?: string }

export type SessionMeta = {
  sessionId: string
  kind: ProtocolKind
  label: string
  target: ProtocolTarget
  cols: number
  rows: number
}

export interface TerminalProtocol {
  readonly kind: ProtocolKind
  start(meta: SessionMeta): Promise<void>
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(signal?: string): void
  output$: Observable<string>
  exit$: Observable<{ code: number; signal?: string }>
}

export function createProtocol(kind: ProtocolKind): TerminalProtocol {
  switch (kind) {
    case 'local':
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return new (require('./local.protocol').LocalProtocol)()
    case 'ssh':
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return new (require('./ssh.protocol').SshProtocol)()
    case 'adb':
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      return new (require('./adb.protocol').AdbProtocol)()
    default:
      throw new Error(`Unknown protocol kind: ${kind}`)
  }
}
