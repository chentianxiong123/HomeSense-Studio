import { Subject, Observable } from 'rxjs'
import { spawn } from 'child_process'
import type { ProtocolTarget, SessionMeta, TerminalProtocol } from './protocol.interface'

/**
 * ADB protocol: spawns an interactive `adb shell -tt` against a serial, pipes bytes both ways.
 * - stdin ← frontend input
 * - stdout/stderr → outputSubject
 * - process exit → exitSubject
 *
 * TODO: replace with persistent connection (adb-track/devices) to avoid per-session
 * adb-spawn latency. For now, one-shot spawn is fine for stub use.
 */
export class AdbProtocol implements TerminalProtocol {
  readonly kind = 'adb' as const
  private proc: ReturnType<typeof spawn> | null = null
  private outputSubject = new Subject<string>()
  private exitSubject = new Subject<{ code: number; signal?: string }>()

  get output$(): Observable<string> { return this.outputSubject.asObservable() }
  get exit$(): Observable<{ code: number; signal?: string }> { return this.exitSubject.asObservable() }

  async start(meta: SessionMeta): Promise<void> {
    const target = meta.target as Extract<ProtocolTarget, { kind: 'adb' }>
    if (!target.serial) {
      throw new Error('ADB target requires serial')
    }
    if (looksLikeTcpAdbTarget(target.serial)) {
      await adbConnect(target.serial)
    }
    const args = ['-s', target.serial, 'shell', '-tt']
    if (target.command) args.push(target.command)
    this.proc = spawn('adb', args, { env: process.env })
    this.outputSubject.next(`ADB shell · ${target.serial}\r\n`)
    this.proc.stdout?.on('data', (d) => this.outputSubject.next(d.toString('utf-8')))
    this.proc.stderr?.on('data', (d) => this.outputSubject.next(d.toString('utf-8')))
    this.proc.on('exit', (code, signal) => {
      this.exitSubject.next({ code: code ?? 0, signal: signal != null ? String(signal) : undefined })
    })
    this.proc.on('error', (err) => {
      this.exitSubject.next({ code: -1, signal: err.message })
    })
  }

  write(data: string): void {
    this.proc?.stdin?.write(data.replace(/\r/g, '\n'))
  }

  resize(_cols: number, _rows: number): void {
    // ADB shell doesn't support PTY resize in basic mode
  }

  kill(signal?: string): void {
    try { this.proc?.kill(signal as any) } catch { /* ignore */ }
  }
}

function looksLikeTcpAdbTarget(serial: string): boolean {
  return /^[^:\s]+:\d+$/.test(serial)
}

function adbConnect(serial: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('adb', ['connect', serial], { env: process.env })
    let output = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { proc.kill() } catch { /* ignore */ }
      reject(new Error(`adb connect ${serial} timed out`))
    }, 15_000)
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    proc.stdout?.on('data', (d) => { output += d.toString('utf-8') })
    proc.stderr?.on('data', (d) => { output += d.toString('utf-8') })
    proc.on('error', (err) => finish(() => reject(err)))
    proc.on('exit', (code) => {
      if (/connected|already connected/i.test(output)) {
        finish(resolve)
        return
      }
      finish(() => reject(new Error(output.trim() || `adb connect ${serial} failed with code ${code ?? 0}`)))
    })
  })
}
