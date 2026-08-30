// HomeSense v3 — 时间线上拉分页
//
// ChatPage 挂载后共享一份 chatAtom.messages 作为当前滚动时间线。
// 滚到顶部时用"最早一条 timelineId"作为 before 游标向 /api/timeline
// 取更早消息,prepend 到 chatAtom（重复行按 timelineId 去重）。

import { useCallback, useEffect, useRef, useState } from "react"

import { loadEarlierTimeline } from "@pico/features/chat/pi-bridge"
import { getChatState, updateChatStore } from "@pico/store/chat"

export function useTimelineHistory() {
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const loadingRef = useRef(false)

  const oldestTimelineId = useCallback((): number | undefined => {
    const messages = getChatState().messages
    const first = messages[0]
    if (!first) return undefined
    return first.timelineId
  }, [])

  const loadOlder = useCallback(async () => {
    if (loadingRef.current) return
    const beforeId = oldestTimelineId()
    if (beforeId === undefined) return

    loadingRef.current = true
    setIsLoadingMore(true)
    setLoadError(false)
    try {
      const older = await loadEarlierTimeline(beforeId)
      if (older.length === 0) {
        setHasMore(false)
        return
      }
      const existingIds = new Set(
        getChatState().messages.map((m) => m.timelineId).filter((id): id is number => typeof id === "number"),
      )
      const fresh = older.filter((m) => m.timelineId !== undefined && !existingIds.has(m.timelineId))
      if (fresh.length > 0) {
        updateChatStore((prev) => ({
          messages: [...fresh, ...prev.messages],
        }))
      }
      if (older.length === 0) setHasMore(false)
    } catch {
      setLoadError(true)
    } finally {
      loadingRef.current = false
      setIsLoadingMore(false)
    }
  }, [oldestTimelineId])

  useEffect(() => {
    setHasMore(true)
  }, [])

  return { hasMore, isLoadingMore, loadError, loadOlder }
}