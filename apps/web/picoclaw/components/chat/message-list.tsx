import { memo } from "react"

import { AssistantMessage } from "@pico/components/chat/assistant-message"
import { UserMessage } from "@pico/components/chat/user-message"
import {
  type AssistantDetailVisibility,
  type ChatMessage,
  shouldShowAssistantMessage,
} from "@pico/store/chat"

interface MessageListProps {
  messages: ChatMessage[]
  assistantDetailVisibility: AssistantDetailVisibility
}

export const MessageList = memo(function MessageList({
  messages,
  assistantDetailVisibility,
}: MessageListProps) {
  return (
    <>
      {messages.map((msg) => {
        if (
          !shouldShowAssistantMessage(assistantDetailVisibility, msg.kind)
        ) {
          return null
        }

        return (
          <div key={msg.id} className="flex w-full">
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
    </>
  )
})
