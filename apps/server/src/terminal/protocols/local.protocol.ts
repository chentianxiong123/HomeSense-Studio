import { Subject, Observable } from 'rxjs'
import * as os from 'os'
import * as pty from 'node-pty'
import type { ProtocolTarget, SessionMeta, TerminalProtocol } from './protocol.interface'

export class LocalProtocol implements TerminalProtocol {
  readonly kind = 'local' as const
  private ptyProc: pty.IPty | null = null
  private outputSubject = new Subject<string>()
  private exitSubject = new Subject<{ code: number; signal?: string }>()

  get output$(): Observable<string> { return this.outputSubject.asObservable() }
  get exit$(): Observable<{ code: number; signal?: string }> { return this.exitSubject.asObservable() }

  async start(meta: SessionMeta): Promise<void> {
    const target = meta.target as Extract<ProtocolTarget, { kind: 'local' }>
    const shell = target.shell ?? (os.platform() === 'win32' ? 'powershell.exe' : 'bash')
    const cwd = target.cwd ?? os.homedir()
    this.ptyProc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: meta.cols,
      rows: meta.rows,
      cwd,
      env: process.env,
    })
    this.ptyProc.onData((d) => this.outputSubject.next(d))
    this.ptyProc.onExit(({ exitCode, signal }) => {
      this.exitSubject.next({ code: exitCode ?? 0, signal: signal != null ? String(signal) : undefined })
    })
  }

  write(data: string): void {
    this.ptyProc?.write(data)
  }

  resize(cols: number, rows: number): void {
    try { this.ptyProc?.resize(cols, rows) } catch { /* ConPTY may throw on resize, ignore */ }
  }

  kill(signal?: string): void {
    try { this.ptyProc?.kill(signal) } catch { /* ignore AttachConsole failure on Windows */ }
  }
}
