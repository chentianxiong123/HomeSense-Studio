import { Subject, Observable } from 'rxjs'
import { Client, ClientChannel } from 'ssh2'
import type { ProtocolTarget, SessionMeta, TerminalProtocol } from './protocol.interface'
import { KeyStore } from '../keystore'

/**
 * SSH protocol: opens an ssh2 client, requests a shell, pipes bytes both ways.
 * - Input bytes from frontend → stream.write
 * - stream stdout/stderr → outputSubject
 * - client 'ready' / 'error' / 'close' → exitSubject
 *
 * Auth: keys are loaded from KeyStore (apps/server/runtime-keys/ssh/) by name.
 * Passwords may be passed inline for ad-hoc use, but production code should
 * prefer keyName to avoid materializing secrets in request flow.
 */
export class SshProtocol implements TerminalProtocol {
  readonly kind = 'ssh' as const
  private client: Client | null = null
  private stream: ClientChannel | null = null
  private outputSubject = new Subject<string>()
  private exitSubject = new Subject<{ code: number; signal?: string }>()

  get output$(): Observable<string> { return this.outputSubject.asObservable() }
  get exit$(): Observable<{ code: number; signal?: string }> { return this.exitSubject.asObservable() }

  async start(meta: SessionMeta): Promise<void> {
    const target = meta.target as Extract<ProtocolTarget, { kind: 'ssh' }>
    if (!target.host || !target.user) {
      throw new Error('SSH target requires host and user')
    }

    this.client = new Client()
    this.client.on('ready', () => {
      this.client!.shell({ cols: meta.cols, rows: meta.rows, term: 'xterm-256color' }, (err, channel) => {
        if (err) {
          this.exitSubject.next({ code: -1, signal: err.message })
          return
        }
        this.stream = channel
        channel.on('data', (data: Buffer) => this.outputSubject.next(data.toString('utf-8')))
        channel.on('close', () => {
          this.exitSubject.next({ code: 0, signal: 'channel closed' })
        })
        channel.stderr.on('data', (data: Buffer) => this.outputSubject.next(data.toString('utf-8')))
      })
    })
    this.client.on('error', (err) => {
      this.exitSubject.next({ code: -1, signal: err.message })
    })
    this.client.on('close', () => {
      this.exitSubject.next({ code: 0, signal: 'client closed' })
    })

    const connectOpts: any = {
      host: target.host,
      port: target.port ?? 22,
      username: target.user,
      readyTimeout: 10000,
    }
    if (target.auth === 'password' && target.password) {
      connectOpts.password = target.password
    } else if (target.auth === 'key' && target.keyName) {
      connectOpts.privateKey = KeyStore.readSshKey(target.keyName)
    } else {
      throw new Error(`SSH target needs ${target.auth === 'password' ? 'password' : 'keyName'}`)
    }

    this.client.connect(connectOpts)
  }

  write(data: string): void {
    this.stream?.write(data)
  }

  resize(cols: number, rows: number): void {
    try { this.stream?.setWindow(rows, cols, 0, 0) } catch { /* ignore */ }
  }

  kill(signal?: string): void {
    try { this.stream?.close() } catch { /* ignore */ }
    try { this.client?.end() } catch { /* ignore */ }
  }
}
