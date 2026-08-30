import { IconPlus } from "@tabler/icons-react"
import { useAtom } from "jotai"
import {
  type ChangeEvent,
  type ClipboardEvent,
  type DragEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react"
import { useTranslation } from "react-i18next"

import { ChatComposer, type ChatInputDisabledReason } from "@pico/components/chat/chat-composer"
import { ChatEmptyState } from "@pico/components/chat/chat-empty-state"
import { MessageList } from "@pico/components/chat/message-list"
import { ModelSelector } from "@pico/components/chat/model-selector"
import { SessionHistoryMenu } from "@pico/components/chat/session-history-menu"
import { TypingIndicator } from "@pico/components/chat/typing-indicator"
import { PageHeader } from "@pico/components/page-header"
import { Button } from "@pico/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pico/components/ui/select"
import {
  CHAT_IMAGE_ACCEPT,
  buildChatImageAttachments,
  getTransferredFiles,
  hasFileTransfer,
} from "@pico/features/chat/image-input"
import { useChatModels } from "@pico/hooks/use-chat-models"
import { useGateway } from "@pico/hooks/use-gateway"
import { usePicoChat } from "@pico/hooks/use-pico-chat"
import { useSessionHistory } from "@pico/hooks/use-session-history"
import type { AssistantDetailVisibility } from "@pico/store/chat"
import type { ConnectionState } from "@pico/store/chat"
import type { ChatAttachment } from "@pico/store/chat"
import {
  assistantDetailVisibilityAtom,
} from "@pico/store/chat"
import type { GatewayState } from "@pico/store/gateway"

function resolveChatInputDisabledReason({
  hasDefaultModel,
  connectionState,
  gatewayState,
}: {
  hasDefaultModel: boolean
  connectionState: ConnectionState
  gatewayState: GatewayState
}): ChatInputDisabledReason | null {
  if (gatewayState === "unknown") {
    return "gatewayUnknown"
  }

  if (gatewayState === "starting") {
    return "gatewayStarting"
  }

  if (gatewayState === "restarting") {
    return "gatewayRestarting"
  }

  if (gatewayState === "stopping") {
    return "gatewayStopping"
  }

  if (gatewayState === "stopped") {
    return "gatewayStopped"
  }

  if (gatewayState === "error") {
    return "gatewayError"
  }

  if (connectionState === "connecting") {
    return "websocketConnecting"
  }

  if (connectionState === "error") {
    return "websocketError"
  }

  if (connectionState === "disconnected") {
    return "websocketDisconnected"
  }

  if (!hasDefaultModel) {
    return "noDefaultModel"
  }

  return null
}

export function ChatPage() {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [hasScrolled, setHasScrolled] = useState(false)
  const [attachments, setAttachments] = useState<ChatAttachment[]>([])
  const [isDragActive, setIsDragActive] = useState(false)
  const [assistantDetailVisibility, setAssistantDetailVisibility] = useAtom(
    assistantDetailVisibilityAtom,
  )

  const assistantDetailVisibilityOptions: Array<{
    value: AssistantDetailVisibility
    label: string
  }> = [
    { value: "none", label: t("chat.assistantDetailVisibility.none") },
    { value: "thought", label: t("chat.assistantDetailVisibility.thought") },
    {
      value: "tool_calls",
      label: t("chat.assistantDetailVisibility.toolCalls"),
    },
    { value: "all", label: t("chat.assistantDetailVisibility.all") },
  ]

  const {
    messages,
    connectionState,
    isTyping,
    activeSessionId,
    contextUsage,
    sendMessage,
    switchSession,
    newChat,
  } = usePicoChat()

  const { state: gwState } = useGateway()
  const isGatewayRunning = gwState === "running"

  const {
    defaultModelName,
    hasAvailableModels,
    apiKeyModels,
    oauthModels,
    localModels,
    settingDefault,
    handleSetDefault,
  } = useChatModels({ isConnected: isGatewayRunning })
  const hasDefaultModel = Boolean(defaultModelName)
  const inputDisabledReason = resolveChatInputDisabledReason({
    hasDefaultModel,
    connectionState,
    gatewayState: gwState,
  })
  const canInput = inputDisabledReason === null

  const {
    sessions,
    hasMore,
    loadError,
    loadErrorMessage,
    observerRef,
    loadSessions,
    handleDeleteSession,
  } = useSessionHistory({
    activeSessionId,
    onDeletedActiveSession: newChat,
  })

  const syncScrollState = (element: HTMLDivElement) => {
    const { clientHeight, scrollHeight, scrollTop } = element
    setHasScrolled(scrollTop > 0)
    setIsAtBottom(scrollHeight - scrollTop <= clientHeight + 10)
  }

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    syncScrollState(e.currentTarget)
  }

  useEffect(() => {
    if (scrollRef.current) {
      if (isAtBottom) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
      syncScrollState(scrollRef.current)
    }
  }, [messages, isTyping, isAtBottom])

  const handleSend = useCallback(
    (payload: { content: string; attachments: ChatAttachment[] }) => {
      if (!canInput) return
      if (
        sendMessage({
          content: payload.content,
          attachments: payload.attachments,
        })
      ) {
        setAttachments([])
      }
    },
    [canInput, sendMessage],
  )

  const handleAddImages = useCallback(() => {
    if (!canInput) return
    fileInputRef.current?.click()
  }, [canInput])

  const handleRemoveAttachment = useCallback((index: number) => {
    setAttachments((prev) => prev.filter((_, itemIndex) => itemIndex !== index))
  }, [])

  const appendImageFiles = useCallback(
    async (files: readonly File[]) => {
      if (!canInput || files.length === 0) {
        return
      }

      const nextAttachments = await buildChatImageAttachments(files, t)
      if (nextAttachments.length === 0) {
        return
      }

      setAttachments((prev) => [...prev, ...nextAttachments])
    },
    [canInput, t],
  )

  const handleImageSelection = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? [])
      event.target.value = ""

      if (files.length === 0) {
        return
      }

      await appendImageFiles(files)
    },
    [appendImageFiles],
  )

  const resetDragState = useCallback(() => {
    dragDepthRef.current = 0
    setIsDragActive(false)
  }, [])

  const handleComposerPaste = useCallback(
    async (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const files = getTransferredFiles(event.clipboardData)
      if (files.length === 0) {
        return
      }

      await appendImageFiles(files)
    },
    [appendImageFiles],
  )

  const handleComposerDragEnter = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasFileTransfer(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      if (!canInput) {
        return
      }
      dragDepthRef.current += 1
      setIsDragActive(true)
    },
    [canInput],
  )

  const handleComposerDragLeave = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasFileTransfer(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      if (!canInput) {
        resetDragState()
        return
      }
      dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
      if (dragDepthRef.current === 0) {
        setIsDragActive(false)
      }
    },
    [canInput, resetDragState],
  )

  const handleComposerDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!hasFileTransfer(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      event.dataTransfer.dropEffect = canInput ? "copy" : "none"
    },
    [canInput],
  )

  const handleComposerDrop = useCallback(
    async (event: DragEvent<HTMLDivElement>) => {
      if (!hasFileTransfer(event.dataTransfer)) {
        return
      }

      event.preventDefault()
      const files = getTransferredFiles(event.dataTransfer)
      resetDragState()

      if (!canInput || files.length === 0) {
        return
      }

      await appendImageFiles(files)
    },
    [canInput, resetDragState, appendImageFiles],
  )

  const handleContextDetail = useCallback(() => {
    if (!canInput) return
    if (sendMessage({ content: "/context", attachments: [] })) {
      setAttachments([])
    }
  }, [canInput, sendMessage])

  return (
    <div className="bg-background/95 flex h-full flex-col">
      <PageHeader
        title={t("navigation.chat")}
        className={`transition-shadow ${
          hasScrolled ? "shadow-xs" : "shadow-none"
        }`}
        titleExtra={
          hasAvailableModels && (
            <ModelSelector
              defaultModelName={defaultModelName}
              apiKeyModels={apiKeyModels}
              oauthModels={oauthModels}
              localModels={localModels}
              disabled={settingDefault}
              onValueChange={handleSetDefault}
            />
          )
        }
      >
        <div className="border-border/60 hidden items-center gap-2 rounded-lg border px-3 py-1.5 sm:flex">
          <span className="text-muted-foreground text-sm">
            {t("chat.showAssistantDetails")}
          </span>
          <Select
            value={assistantDetailVisibility}
            onValueChange={(value) =>
              setAssistantDetailVisibility(value as AssistantDetailVisibility)
            }
          >
            <SelectTrigger
              size="sm"
              aria-label={t("chat.showAssistantDetails")}
              className="text-muted-foreground hover:text-foreground focus-visible:border-input h-8 min-w-[104px] bg-transparent shadow-none focus-visible:ring-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent align="end">
              {assistantDetailVisibilityOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={newChat}
          className="h-9 gap-2"
        >
          <IconPlus className="size-4" />
          <span className="hidden sm:inline">{t("chat.newChat")}</span>
        </Button>

        <SessionHistoryMenu
          sessions={sessions}
          activeSessionId={activeSessionId}
          hasMore={hasMore}
          loadError={loadError}
          loadErrorMessage={loadErrorMessage}
          observerRef={observerRef}
          onOpenChange={(open) => {
            if (open) {
              void loadSessions(true)
            }
          }}
          onSwitchSession={switchSession}
          onDeleteSession={handleDeleteSession}
        />
      </PageHeader>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-6 md:px-8 lg:px-24 xl:px-48"
      >
        <div className="mx-auto flex w-full max-w-250 flex-col gap-8 pb-8">
          {messages.length === 0 && !isTyping && (
            <ChatEmptyState
              hasAvailableModels={hasAvailableModels}
              defaultModelName={defaultModelName}
              isConnected={isGatewayRunning}
            />
          )}

          <MessageList
            messages={messages}
            assistantDetailVisibility={assistantDetailVisibility}
          />

          {isTyping && <TypingIndicator />}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept={CHAT_IMAGE_ACCEPT}
        multiple
        className="hidden"
        onChange={handleImageSelection}
      />

      <ChatComposer
        attachments={attachments}
        onAddImages={handleAddImages}
        onPaste={handleComposerPaste}
        onDragEnter={handleComposerDragEnter}
        onDragLeave={handleComposerDragLeave}
        onDragOver={handleComposerDragOver}
        onDrop={handleComposerDrop}
        onRemoveAttachment={handleRemoveAttachment}
        onSend={handleSend}
        onContextDetail={handleContextDetail}
        inputDisabledReason={inputDisabledReason}
        isDragActive={isDragActive}
        contextUsage={contextUsage}
      />
    </div>
  )
}
