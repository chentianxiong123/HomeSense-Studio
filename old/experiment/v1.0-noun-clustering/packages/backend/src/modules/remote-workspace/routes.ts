import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import * as pty from 'node-pty'
import { remoteWorkspaceService } from './index.js'

type TerminalLaunch = Awaited<ReturnType<typeof remoteWorkspaceService.createTerminalLaunch>>

interface TerminalSocketWriter {
  send: (payload: string) => void
}

interface TerminalSession {
  id: string
  launch: TerminalLaunch
  pty: pty.IPty
  sockets: Set<TerminalSocketWriter>
  cleanupTimer: NodeJS.Timeout | null
}

const terminalSessions = new Map<string, TerminalSession>()

export async function remoteWorkspaceRoutes(app: FastifyInstance) {
  app.get('/api/remote-workspace/status', async () => {
    return { status: 'success', data: await remoteWorkspaceService.getStatus() }
  })

  app.get('/api/remote-workspace/targets', async () => {
    return { status: 'success', data: await remoteWorkspaceService.listTargets() }
  })

  app.post('/api/remote-workspace/targets', async (request, reply) => {
    try {
      const target = await remoteWorkspaceService.registerTarget((request.body as Record<string, unknown>) ?? {})
      return { status: 'success', data: target }
    } catch (error) {
      reply.code(400)
      return { status: 'error', error: 'REGISTER_FAILED', message: (error as Error).message }
    }
  })

  app.delete('/api/remote-workspace/targets/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const removed = remoteWorkspaceService.removeTarget(id)
    if (!removed) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND', message: `Remote workspace target not found: ${id}` }
    }
    return { status: 'success' }
  })

  app.post('/api/remote-workspace/targets/:id/probe', async (request, reply) => {
    const { id } = request.params as { id: string }
    const result = await remoteWorkspaceService.probeTarget(id)
    if (!result) {
      reply.code(404)
      return { status: 'error', error: 'NOT_FOUND', message: `Remote workspace target not found: ${id}` }
    }
    return { status: 'success', data: result }
  })

  app.get('/api/remote-workspace/filesystem/tree', async (request, reply) => {
    try {
      const query = (request.query as Record<string, unknown>) ?? {}
      const data = await remoteWorkspaceService.listFiles({
        target_id: typeof query.target_id === 'string' ? query.target_id : undefined,
        path: typeof query.path === 'string' ? query.path : undefined,
        limit: typeof query.limit === 'string' ? Number(query.limit) : undefined,
      })
      return { status: 'success', data }
    } catch (error) {
      reply.code(400)
      return { status: 'error', error: 'FILESYSTEM_TREE_FAILED', message: (error as Error).message }
    }
  })

  app.get('/api/remote-workspace/filesystem/file', async (request, reply) => {
    try {
      const query = (request.query as Record<string, unknown>) ?? {}
      const data = await remoteWorkspaceService.readFile({
        target_id: typeof query.target_id === 'string' ? query.target_id : undefined,
        path: typeof query.path === 'string' ? query.path : undefined,
      })
      return { status: 'success', data }
    } catch (error) {
      reply.code(400)
      return { status: 'error', error: 'FILESYSTEM_FILE_FAILED', message: (error as Error).message }
    }
  })

  app.post('/api/remote-workspace/start', async () => {
    return { status: 'success', data: await remoteWorkspaceService.start() }
  })

  app.post('/api/remote-workspace/stop', async () => {
    return { status: 'success', data: await remoteWorkspaceService.stop() }
  })

  app.get('/api/remote-workspace/terminal', { websocket: true }, async (socket, request) => {
    const query = (request.query as Record<string, unknown>) ?? {}
    const targetId = typeof query.target_id === 'string' ? query.target_id : ''
    const requestedSessionId = typeof query.session_id === 'string' ? query.session_id : ''
    const cols = clampTerminalSize(query.cols, 120, 20, 300)
    const rows = clampTerminalSize(query.rows, 32, 8, 120)
    try {
      const session = requestedSessionId && terminalSessions.has(requestedSessionId)
        ? terminalSessions.get(requestedSessionId)!
        : await createTerminalSession(targetId, cols, rows)

      if (session.cleanupTimer) {
        clearTimeout(session.cleanupTimer)
        session.cleanupTimer = null
      }
      const socketWriter: TerminalSocketWriter = {
        send: (payload: string) => socket.send(payload),
      }
      session.sockets.add(socketWriter)

      socket.send(JSON.stringify({
        type: 'session_opened',
        data: {
          session_id: session.id,
          target_id: session.launch.target_id,
          label: session.launch.label,
          kind: session.launch.kind,
          command: session.launch.command,
          args: session.launch.args,
          transport: 'pty',
        },
      }))
      session.pty.resize(cols, rows)

      socket.on('message', (msg: Buffer) => {
        const text = msg.toString()
        if (text === 'close') {
          closeTerminalSession(session.id)
          return
        }
        try {
          const parsed = JSON.parse(text) as Record<string, unknown>
          if (parsed.type === 'input' && typeof parsed.data === 'string') {
            session.pty.write(parsed.data)
            return
          }
          if (parsed.type === 'input' && typeof parsed.data === 'object' && parsed.data !== null) {
            const data = parsed.data as Record<string, unknown>
            if (typeof data.value === 'string') session.pty.write(data.value)
            return
          }
          if (parsed.type === 'resize' && typeof parsed.data === 'object' && parsed.data !== null) {
            const data = parsed.data as Record<string, unknown>
            session.pty.resize(
              clampTerminalSize(data.cols, cols, 20, 300),
              clampTerminalSize(data.rows, rows, 8, 120),
            )
          }
        } catch {
          session.pty.write(text)
        }
      })

      socket.on('close', () => {
        session.sockets.delete(socketWriter)
        if (session.sockets.size === 0) {
          session.cleanupTimer = setTimeout(() => {
            closeTerminalSession(session.id)
          }, 5 * 60 * 1000)
          session.cleanupTimer.unref?.()
        }
      })
    } catch (error) {
      socket.send(JSON.stringify({
        type: 'error',
        data: { message: (error as Error).message },
      }))
      socket.close()
    }
  })
}

async function createTerminalSession(targetId: string, cols: number, rows: number) {
  const launch = await remoteWorkspaceService.createTerminalLaunch({ target_id: targetId })
  const id = randomUUID()
  const terminal = pty.spawn(launch.command, launch.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: launch.cwd,
    env: {
      ...process.env,
      ...(launch.env ?? {}),
    },
  })
  const session: TerminalSession = {
    id,
    launch,
    pty: terminal,
    sockets: new Set<{ send: (payload: string) => void }>(),
    cleanupTimer: null,
  }
  terminalSessions.set(id, session)
  terminal.onData((data) => {
    broadcastTerminal(session.id, {
      type: 'stdout',
      data,
    })
  })
  terminal.onExit(({ exitCode, signal }) => {
    broadcastTerminal(session.id, {
      type: 'exit',
      data: { code: exitCode, signal },
    })
    terminalSessions.delete(session.id)
  })
  return session
}

function broadcastTerminal(sessionId: string, message: Record<string, unknown>) {
  const session = terminalSessions.get(sessionId)
  if (!session) return
  const payload = JSON.stringify(message)
  for (const item of session.sockets) {
    try {
      item.send(payload)
    } catch {}
  }
}

function closeTerminalSession(sessionId: string) {
  const session = terminalSessions.get(sessionId)
  if (!session) return
  if (session.cleanupTimer) clearTimeout(session.cleanupTimer)
  broadcastTerminal(sessionId, {
    type: 'exit',
    data: { code: null, signal: 'closed' },
  })
  terminalSessions.delete(sessionId)
  try {
    session.pty.kill()
  } catch {}
}

function clampTerminalSize(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, Math.floor(parsed)))
}
