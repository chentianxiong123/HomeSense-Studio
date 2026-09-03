package agent

import (
	"context"
	"strings"

	toolshared "github.com/sipeed/picoclaw/pkg/tools/shared"
)

// MemoryTool lets the agent persist long-term memory (MEMORY.md) and daily
// notes (memory/YYYYMM/YYYYMMDD.md) into its own workspace. The memory content
// is re-injected into the prompt on every turn via ContextBuilder, so anything
// written here is available across sessions.
type MemoryTool struct {
	store *MemoryStore
}

// NewMemoryTool creates a memory tool rooted at the agent workspace.
func NewMemoryTool(workspace string) *MemoryTool {
	return &MemoryTool{store: NewMemoryStore(workspace)}
}

func (t *MemoryTool) Name() string { return "memory" }

func (t *MemoryTool) Description() string {
	return `Persistent memory for this home/brain. Use to remember facts about the user, the household, preferences, or long-lived project state across conversations.

Actions:
- "write_long_term": overwrite (or set) the long-term memory file (MEMORY.md). Prefer for durable facts about the user/home. Pass full content you want to keep.
- "append_daily_note": append a short note to today's daily memory file (memory/YYYYMM/YYYYMMDD.md). Prefer for day-specific events or quick observations.

The memory is automatically included in future conversation context, so keep entries concise and well-structured.`
}

func (t *MemoryTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"action": map[string]any{
				"type": "string",
				"enum": []string{"write_long_term", "append_daily_note"},
				"description": "Which memory action to perform.",
			},
			"content": map[string]any{
				"type":        "string",
				"description": "The memory content to persist.",
			},
		},
		"required": []string{"action", "content"},
	}
}

func (t *MemoryTool) Execute(_ context.Context, args map[string]any) *toolshared.ToolResult {
	action, _ := args["action"].(string)
	content, _ := args["content"].(string)
	content = strings.TrimSpace(content)

	if action == "" || content == "" {
		return toolshared.ErrorResult(
			"Missing required 'action' or 'content' argument. Example: {\"action\": \"write_long_term\", \"content\": \"用户偏好...\"}",
		)
	}

	switch action {
	case "write_long_term":
		if err := t.store.WriteLongTerm(content); err != nil {
			return toolshared.ErrorResult("Failed to write long-term memory: " + err.Error())
		}
		return toolshared.NewToolResult("Long-term memory updated.")
	case "append_daily_note":
		if err := t.store.AppendToday(content); err != nil {
			return toolshared.ErrorResult("Failed to append daily note: " + err.Error())
		}
		return toolshared.NewToolResult("Daily note appended.")
	default:
		return toolshared.ErrorResult(
			"Unknown action " + action + ". Supported actions: write_long_term, append_daily_note",
		)
	}
}
