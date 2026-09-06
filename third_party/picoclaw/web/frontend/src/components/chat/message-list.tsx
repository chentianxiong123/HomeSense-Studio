import { useVirtualizer } from "@tanstack/react-virtual"
import {
  memo,
  useEffect,
  useRef,
} from "react"

import { AssistantMessage } from "@/components/chat/assistant-message"
import { UserMessage } from "@/components/chat/user-message"
import {
  type AssistantDetailVisibility,
  type ChatMessage,
  shouldShowAssistantMessage,
} from "@/store/chat"

interface MessageListProps {
  messages: ChatMessage[]
  assistantDetailVisibility: AssistantDetailVisibility
  scrollRef: React.RefObject<HTMLDivElement | null>
  isAtBottom: boolean
}

const DEFAULT_ROW_HEIGHT = 72

export const MessageList = memo(function MessageList({
  messages,
  assistantDetailVisibility,
  scrollRef,
  isAtBottom,
}: MessageListProps) {
  const isAtBottomRef = useRef(isAtBottom)
  isAtBottomRef.current = isAtBottom

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DEFAULT_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => messages[index].id,
  })

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    virtualizer.measure()

    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight
      })
    }
  }, [messages.length, isAtBottom, scrollRef, virtualizer])

  return (
    <div
      className="relative w-full"
      style={{
        height: `${virtualizer.getTotalSize()}px`,
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const msg = messages[virtualRow.index]
        if (
          !msg ||
          !shouldShowAssistantMessage(assistantDetailVisibility, msg.kind)
        ) {
          return null
        }

        return (
          <div
            key={virtualRow.key}
            className="absolute top-0 flex w-full"
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            style={{
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {msg.role === "assistant" ? (
              <AssistantMessage
                content={msg.content}
                attachments={msg.attachments}
                kind={msg.kind}
                modelName={msg.modelName}
                toolCalls={msg.toolCalls}
                timestamp={msg.timestamp}
              />
            ) : (
              <UserMessage
                content={msg.content}
                attachments={msg.attachments}
                timestamp={msg.timestamp}
              />
            )}
          </div>
        )
      })}
    </div>
  )
})