import type { ToolSupportItem, WebSearchConfigResponse } from "@pico/api/tools"

export type ToolsPageTab = "library" | "web-search"
export type ToolStatusFilter = "all" | ToolSupportItem["status"]
export type GroupedTools = Array<[string, ToolSupportItem[]]>

export type WebSearchDraftUpdater = (
  updater: (current: WebSearchConfigResponse) => WebSearchConfigResponse,
) => void
