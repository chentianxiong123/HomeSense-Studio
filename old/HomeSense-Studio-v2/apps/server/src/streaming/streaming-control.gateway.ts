import { Logger } from '@nestjs/common'
import { WebSocket, WebSocketServer } from 'ws'
import type { Server } from 'node:http'

const PATH = '/api/streaming-gateway/control/ws'
const log = new Logger('StreamingControlGateway')

type ClientRole = 'controller' | 'viewer'

type ControlEvent = {
  id: string
  kind: 'button' | 'axis' | 'pointer' | 'text' | 'system'
  action: string
  value?: unknown
  at: string
  source: ClientRole
}

type Incoming =
  | { type: 'join'; session_id: string; role: ClientRole; client_id?: string }
  | { type: 'input'; session_id: string; event: Omit<ControlEvent, 'id' | 'at' | 'source'> & { id?: string; at?: string } }
  | { type: 'ping'; session_id?: string }

type Client = {
  ws: WebSocket
  sessionId: string
  role: ClientRole
  clientId: string
}

export class StreamingControlGateway {
  private wss: WebSocketServer | null = null
  private clients = new Map<WebSocket, Client>()

  attach(server: Server) {
    this.wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (req, socket, head) => {
      const url = req.url ?? ''
      if (!url.startsWith(PATH)) return
      this.wss!.handleUpgrade(req, socket, head, (ws) => {
        this.handleConnection(ws as unknown as WebSocket)
      })
    })
    log.log(`WebSocket listening on ${PATH}`)
  }

  private handleConnection(ws: WebSocket) {
    ws.on('message', (raw) => {
      let message: Incoming
      try {
        message = JSON.parse(raw.toString()) as Incoming
      } catch {
        send(ws, { type: 'error', data: { message: 'invalid json' } })
        return
      }

      if (message.type === 'ping') {
        send(ws, { type: 'pong', data: { at: new Date().toISOString() } })
        return
      }

      if (message.type === 'join') {
        const sessionId = normalizeSessionId(message.session_id)
        const role = normalizeRole(message.role)
        if (!sessionId || !role) {
          send(ws, { type: 'error', data: { message: 'invalid session or role' } })
          return
        }
        const client: Client = {
          ws,
          sessionId,
          role,
          clientId: String(message.client_id || randomId('client')).slice(0, 64),
        }
        this.clients.set(ws, client)
        send(ws, {
          type: 'joined',
          data: {
            session_id: sessionId,
            role,
            client_id: client.clientId,
            peers: this.countPeers(sessionId),
          },
        })
        this.broadcast(sessionId, ws, {
          type: 'peer',
          data: { event: 'joined', role, client_id: client.clientId, peers: this.countPeers(sessionId) },
        })
        return
      }

      if (message.type === 'input') {
        const client = this.clients.get(ws)
        if (!client || client.sessionId !== normalizeSessionId(message.session_id)) {
          send(ws, { type: 'error', data: { message: 'join required' } })
          return
        }

        const event: ControlEvent = {
          id: String(message.event.id || randomId('evt')).slice(0, 96),
          kind: normalizeKind(message.event.kind),
          action: String(message.event.action || '').slice(0, 80),
          value: message.event.value,
          at: String(message.event.at || new Date().toISOString()),
          source: client.role,
        }
        if (!event.action) {
          send(ws, { type: 'error', data: { message: 'event action is required' } })
          return
        }

        this.broadcast(client.sessionId, ws, {
          type: 'input',
          data: {
            session_id: client.sessionId,
            event,
          },
        })
        send(ws, { type: 'ack', data: { event_id: event.id, at: new Date().toISOString() } })
      }
    })

    ws.on('close', () => {
      const client = this.clients.get(ws)
      this.clients.delete(ws)
      if (client) {
        this.broadcast(client.sessionId, ws, {
          type: 'peer',
          data: { event: 'left', role: client.role, client_id: client.clientId, peers: this.countPeers(client.sessionId) },
        })
      }
    })
  }

  private broadcast(sessionId: string, exclude: WebSocket, payload: unknown) {
    for (const client of this.clients.values()) {
      if (client.sessionId !== sessionId || client.ws === exclude) continue
      send(client.ws, payload)
    }
  }

  private countPeers(sessionId: string) {
    let controllers = 0
    let viewers = 0
    for (const client of this.clients.values()) {
      if (client.sessionId !== sessionId) continue
      if (client.role === 'controller') controllers += 1
      else viewers += 1
    }
    return { controllers, viewers }
  }
}

function send(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(payload))
}

function normalizeSessionId(value: unknown): string {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)
}

function normalizeRole(value: unknown): ClientRole | null {
  return value === 'controller' || value === 'viewer' ? value : null
}

function normalizeKind(value: unknown): ControlEvent['kind'] {
  if (value === 'axis' || value === 'pointer' || value === 'text' || value === 'system') return value
  return 'button'
}

function randomId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`
}
