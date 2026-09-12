package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	toolshared "github.com/sipeed/picoclaw/pkg/tools/shared"
)

// historySearchTool implements toolshared.Tool for full-text search over
// the user's conversation history stored in sessions.db via FTS5.
type historySearchTool struct {
	dbPath string
	db     *sql.DB
}

// newHistorySearchTool opens a read-only SQLite connection to the user's
// sessions.db and ensures the FTS5 virtual table exists.
func newHistorySearchTool(workspace string) (*historySearchTool, error) {
	dbPath := filepath.Join(workspace, "sessions", "sessions.db")
	if _, err := os.Stat(dbPath); err != nil {
		return nil, fmt.Errorf("sessions.db not found: %w", err)
	}
	db, err := sql.Open("sqlite", dbPath+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)&_pragma=mode(ro)")
	if err != nil {
		return nil, fmt.Errorf("open sessions.db read-only: %w", err)
	}
	db.SetMaxOpenConns(1)

	// Create FTS5 virtual table if it doesn't exist. Uses a content-sync
	// table so new rows added by picoclaw's SQLiteStore are automatically
	// indexed on the next FTS query (content=messages).
	if _, err := db.Exec(`
		CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
			content,
			content='messages',
			content_rowid='rowid',
			tokenize='unicode61'
		)
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create FTS5 table: %w", err)
	}

	return &historySearchTool{dbPath: dbPath, db: db}, nil
}

func (t *historySearchTool) Name() string { return "history_search" }

func (t *historySearchTool) Description() string {
	return "Search the user's conversation history using full-text search (FTS5). Use this to recall past conversations, find previous discussions, or look up what was said before on a topic."
}

func (t *historySearchTool) Parameters() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"query": map[string]any{
				"type":        "string",
				"description": "The search query (supports FTS5 syntax: AND, OR, NOT, phrases in quotes, prefix with *)",
			},
			"limit": map[string]any{
				"type":        "integer",
				"description": "Maximum number of results to return (default: 10, max: 50)",
			},
		},
		"required": []string{"query"},
	}
}

func (t *historySearchTool) Execute(ctx context.Context, args map[string]any) *toolshared.ToolResult {
	query, _ := args["query"].(string)
	if strings.TrimSpace(query) == "" {
		return &toolshared.ToolResult{ForLLM: "Error: query is required and cannot be empty", IsError: true}
	}

	limit := 10
	if v, ok := args["limit"].(float64); ok && v > 0 {
		limit = int(v)
		if limit > 50 {
			limit = 50
		}
	}

	// Rebuild FTS index to pick up any new messages since last query.
	// This is cheap for small-to-medium databases.
	_, _ = t.db.ExecContext(ctx, `INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`)

	// Search using FTS5 MATCH. We use the messages table's rowid to join
	// back to the actual message data.
	rows, err := t.db.QueryContext(ctx, `
		SELECT m.session_key, m.seq, m.role, m.content, m.created_at
		FROM messages m
		INNER JOIN messages_fts f ON m.rowid = f.rowid
		WHERE messages_fts MATCH ?
		ORDER BY rank
		LIMIT ?
	`, query, limit)
	if err != nil {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Search error: %v", err), IsError: true}
	}
	defer rows.Close()

	var results []string
	count := 0
	for rows.Next() {
		var sessionKey, role, content string
		var seq, createdAt int64
		if err := rows.Scan(&sessionKey, &seq, &role, &content, &createdAt); err != nil {
			continue
		}
		count++
		// Truncate long messages for readability
		if len(content) > 300 {
			content = content[:300] + "..."
		}
		results = append(results, fmt.Sprintf("[%d] (seq=%d, %s) %s", count, seq, role, content))
	}

	if count == 0 {
		return &toolshared.ToolResult{ForLLM: fmt.Sprintf("No results found for: %s", query)}
	}

	return &toolshared.ToolResult{ForLLM: fmt.Sprintf("Found %d results:\n%s", count, strings.Join(results, "\n"))}
}

// Close releases the database connection.
func (t *historySearchTool) Close() error {
	if t.db != nil {
		return t.db.Close()
	}
	return nil
}
