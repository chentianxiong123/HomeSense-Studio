// Session id handling for the single-conversation chat.
//
// v7 pins one user to exactly one session server-side (fixedSessionHandler
// rewrites every WebSocket session_id to "user:<userID>"), so the web client
// never needs to generate or remember session ids. The active session id is
// only resolved from the server's single-session list at startup.

export function getInitialActiveSessionId(): string {
  return ""
}

export function normalizeUnixTimestamp(timestamp: number): number {
  return timestamp < UNIX_MS_THRESHOLD ? timestamp * 1000 : timestamp
}

const UNIX_MS_THRESHOLD = 1e12
