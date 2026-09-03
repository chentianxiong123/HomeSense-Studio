/** Context TTL in milliseconds — shared across frontend & backend.
 *  If the last interaction was longer ago than this, context is considered stale.
 *  Derived from the chat message time-divider threshold (currently 30 min).
 */
export const CONTEXT_TTL_MS = 30 * 60 * 1000

/** Human-readable label */
export const CONTEXT_TTL_LABEL = '30min'
