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

const VIRTUALIZE_THRESHOLD = 200

export const MessageList = memo(function MessageList({
  messages,
  assistantDetailVisibility,
  scrollRef,
  isAtBottom,
}: MessageListProps) {
  const isAtBottomRef = useRef(isAtBottom)
  isAtBottomRef.current = isAtBottom

  const visibleMessages = messages.filter((msg) =>
    shouldShowAssistantMessage(assistantDetailVisibility, msg.kind),
  )

  const shouldVirtualize = visibleMessages.length >= VIRTUALIZE_THRESHOLD

  const virtualizer = useVirtualizer({
    count: visibleMessages.length,
    enabled: shouldVirtualize,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => DEFAULT_ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => visibleMessages[index]?.id ?? index,
  })

  useEffect(() => {
    const element = scrollRef.current
    if (!element) {
      return
    }

    if (isAtBottomRef.current) {
      requestAnimationFrame(() => {
        element.scrollTop = element.scrollHeight
      })
    }
  }, [visibleMessages.length, isAtBottom, scrollRef])

  const renderMessage = (msg: ChatMessage) =>
    msg.role === "assistant" ? (
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
    )

  if (!shouldVirtualize) {
    return (
      <div className="flex w-full flex-col gap-8 pb-8">
        {visibleMessages.map((msg) => (
          <div key={msg.id} className="flex w-full">
            {renderMessage(msg)}
          </div>
        ))}
      </div>
    )
  }

  return (
    <div
      className="relative w-full"
      style={{
        height: `${virtualizer.getTotalSize()}px`,
      }}
    >
      {virtualizer.getVirtualItems().map((virtualRow) => {
        const msg = visibleMessages[virtualRow.index]
        if (!msg) {
          return null
        }

        return (
          <div
            key={virtualRow.key}
            className="absolute top-0 flex w-full pb-8"
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            style={{
              transform: `translateY(${virtualRow.start}px)`,
            }}
          >
            {renderMessage(msg)}
          </div>
        )
      })}
    </div>
  )
})
