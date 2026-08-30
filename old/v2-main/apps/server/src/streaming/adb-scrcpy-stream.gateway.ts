import { Injectable, Logger } from '@nestjs/common'
import type { Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'
import { AdbScrcpySessionService } from './adb-scrcpy-session.service'

const PATH_PREFIX = '/api/streaming-gateway/adb-scrcpy/sessions/'
const PATH_SUFFIX = '/stream.ws'
const log = new Logger('AdbScrcpyStreamGateway')

@Injectable()
export class AdbScrcpyStreamGateway {
  private wss: WebSocketServer | null = null

  constructor(private readonly sessions: AdbScrcpySessionService) {}

  attach(server: Server) {
    this.wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      const pathname = safePathname(req.url ?? '')
      const sessionId = extractSessionId(pathname)
      if (!sessionId) return
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        try {
          this.sessions.pipeRawStreamToWebSocket(sessionId, ws as unknown as WebSocket)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          log.warn(`raw stream attach failed: ${message}`)
          ;(ws as unknown as WebSocket).close(1011, message.slice(0, 80) || 'raw stream attach failed')
        }
      })
    })
    log.log(`WebSocket listening on ${PATH_PREFIX}:id${PATH_SUFFIX}`)
  }
}

function safePathname(rawUrl: string): string {
  try {
    return new URL(rawUrl, 'http://localhost').pathname
  } catch {
    return rawUrl.split('?')[0] || ''
  }
}

function extractSessionId(pathname: string): string {
  if (!pathname.startsWith(PATH_PREFIX) || !pathname.endsWith(PATH_SUFFIX)) return ''
  const encoded = pathname.slice(PATH_PREFIX.length, -PATH_SUFFIX.length)
  return decodeURIComponent(encoded).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
}
