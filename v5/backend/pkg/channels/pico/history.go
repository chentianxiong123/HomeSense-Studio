package pico

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/agent"
	"github.com/sipeed/picoclaw/pkg/logger"
	_ "modernc.org/sqlite"
)

// PicoHistoryMessage is one persisted chat message for a pico session.
type PicoHistoryMessage struct {
	ID        int64  `json:"id"`
	SessionID string `json:"session_id"`
	Role      string `json:"role"` // "user" | "assistant"
	Content   string `json:"content"`
	Model     string `json:"model"`
	Kind      string `json:"kind"` // "normal" | "thought" | "tool_calls"
	CreatedAt string `json:"created_at"`
}

// PicoHistoryStore persists pico chat messages per session into SQLite.
// It is the single storage owner for the pico conversation timeline; the
// frontend reads history from here instead of a separate Next.js SQLite.
type PicoHistoryStore struct {
	db *sql.DB
	mu sync.Mutex
}

const picoHistorySchema = `
CREATE TABLE IF NOT EXISTS pico_messages (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id TEXT NOT NULL,
	role       TEXT NOT NULL,
	content    TEXT NOT NULL DEFAULT '',
	model      TEXT NOT NULL DEFAULT '',
	kind       TEXT NOT NULL DEFAULT 'normal',
	created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pico_messages_session ON pico_messages(session_id, id);
CREATE TABLE IF NOT EXISTS pico_usage (
	id              INTEGER PRIMARY KEY AUTOINCREMENT,
	session_id      TEXT NOT NULL,
	model           TEXT NOT NULL DEFAULT '',
	task            TEXT NOT NULL DEFAULT '',
	requests        INTEGER NOT NULL DEFAULT 0,
	input_tokens    INTEGER NOT NULL DEFAULT 0,
	output_tokens   INTEGER NOT NULL DEFAULT 0,
	estimated_cost_usd REAL NOT NULL DEFAULT 0,
	cost_status     TEXT NOT NULL DEFAULT 'unknown',
	first_seen      TEXT NOT NULL DEFAULT (datetime('now')),
	last_seen       TEXT NOT NULL DEFAULT (datetime('now')),
	UNIQUE(session_id, model, task)
);
CREATE INDEX IF NOT EXISTS idx_pico_usage_model ON pico_usage(model);
CREATE INDEX IF NOT EXISTS idx_pico_usage_last_seen ON pico_usage(last_seen);
`

// PicoUsageSummary aggregates usage for a period, grouped by model.
type PicoUsageSummary struct {
	Model           string  `json:"model"`
	Requests        int     `json:"requests"`
	InputTokens     int     `json:"input_tokens"`
	OutputTokens    int     `json:"output_tokens"`
	TotalTokens     int     `json:"total_tokens"`
	EstimatedCostUsd float64 `json:"estimated_cost_usd"`
}

// PicoUsageTotals are the grand totals for a period.
type PicoUsageTotals struct {
	Requests     int               `json:"requests"`
	InputTokens  int               `json:"input_tokens"`
	OutputTokens int               `json:"output_tokens"`
	TotalTokens  int               `json:"total_tokens"`
	EstimatedCostUsd float64       `json:"estimated_cost_usd"`
	ByModel      []PicoUsageSummary `json:"by_model"`
}

// NewPicoHistoryStore opens (or creates) a SQLite database at path and
// ensures the pico message schema exists.
func NewPicoHistoryStore(path string) (*PicoHistoryStore, error) {
	if path == "" {
		return nil, fmt.Errorf("pico history: empty db path")
	}
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return nil, fmt.Errorf("pico history: mkdir %s: %w", dir, err)
		}
	}
	db, err := sql.Open("sqlite", path)
	if err != nil {
		return nil, fmt.Errorf("pico history: open %s: %w", path, err)
	}
	// modernc sqlite is pure-go; a single writer with a mutex is enough.
	db.SetMaxOpenConns(1)
	if err := migratePicoUsageSchema(db); err != nil {
		db.Close()
		return nil, fmt.Errorf("pico history: migrate usage schema: %w", err)
	}
	if _, err := db.Exec(picoHistorySchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("pico history: schema: %w", err)
	}
	return &PicoHistoryStore{db: db}, nil
}

// migratePicoUsageSchema drops a legacy pico_usage table (created before this
// metering redesign) and lets the new accumulated schema take its place. The
// old row-per-call table had no cost/task/requests columns and held no data
// worth preserving in dev; this keeps CREATE TABLE IF NOT EXISTS from silently
// pinning the stale shape. No-op when the table is absent or already new.
func migratePicoUsageSchema(db *sql.DB) error {
	rows, err := db.Query(`PRAGMA table_info(pico_usage)`)
	if err != nil {
		return err
	}
	defer rows.Close()
	cols := map[string]bool{}
	for rows.Next() {
		var cid, notnull, pk int
		var name, ctype string
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return err
		}
		cols[name] = true
	}
	if err := rows.Err(); err != nil {
		return err
	}
	// New schema has 'task'; legacy has 'total_tokens' and 'created_at' only.
	needsMigration := len(cols) > 0 && !cols["task"] && (cols["total_tokens"] || cols["created_at"])
	if !needsMigration {
		return nil
	}
	if _, err := db.Exec(`DROP TABLE pico_usage`); err != nil {
		return err
	}
	return nil
}

// Append inserts a message and returns its id. Safe for concurrent callers.
func (s *PicoHistoryStore) Append(
	ctx context.Context,
	sessionID, role, content, model, kind string,
) (int64, error) {
	if s == nil || s.db == nil {
		return 0, nil
	}
	if kind == "" {
		kind = "normal"
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	res, err := s.db.ExecContext(
		ctx,
		`INSERT INTO pico_messages (session_id, role, content, model, kind, created_at)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		sessionID, role, content, model, kind,
		time.Now().UTC().Format(time.RFC3339Nano),
	)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

// RecordLLMUsage implements agent.UsageRecorder — the single metering
// chokepoint for every LLM call. Accumulates per (session, model, task) into
// pico_usage (mirrors hermes' session_model_usage), so mid-session model
// switches meter to the correct model row. Best-effort, never fails the turn.
// task == "" is the main agent loop; aux tasks (tools, summarization, ...)
// record under their own task label.
func (s *PicoHistoryStore) RecordLLMUsage(ctx context.Context, usage agent.LLMUsageRecord) {
	if s == nil || s.db == nil {
		return
	}
	if usage.InputTokens <= 0 && usage.OutputTokens <= 0 {
		return
	}
	model := strings.TrimSpace(usage.Model)
	if model == "" {
		model = "unknown"
	}
	now := time.Now().UTC().Format(time.RFC3339Nano)
	s.mu.Lock()
	defer s.mu.Unlock()
	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO pico_usage
		    (session_id, model, task, requests, input_tokens, output_tokens, first_seen, last_seen)
		 VALUES (?, ?, '', 1, ?, ?, ?, ?)
		 ON CONFLICT(session_id, model, task) DO UPDATE SET
		    requests = requests + 1,
		    input_tokens = input_tokens + excluded.input_tokens,
		    output_tokens = output_tokens + excluded.output_tokens,
		    last_seen = excluded.last_seen`,
		usage.SessionKey, model, usage.InputTokens, usage.OutputTokens, now, now,
	)
	if err != nil {
		logger.WarnCF("pico", "usage record failed", map[string]any{"error": err.Error()})
	}
}

// MonthUsage aggregates this tenant's usage since the start of the current
// UTC month, grouped by model. This is the metering data the control plane
// reads to bill/enforce quotas.
func (s *PicoHistoryStore) MonthUsage(ctx context.Context, now time.Time) (PicoUsageTotals, error) {
	var totals PicoUsageTotals
	if s == nil || s.db == nil {
		return totals, nil
	}
	monthStart := time.Date(now.UTC().Year(), now.UTC().Month(), 1, 0, 0, 0, 0, time.UTC).Format(time.RFC3339Nano)

	s.mu.Lock()
	defer s.mu.Unlock()

	modelRows, err := s.db.QueryContext(
		ctx,
		`SELECT COALESCE(model, ''),
		        COALESCE(SUM(requests), 0),
		        COALESCE(SUM(input_tokens), 0),
		        COALESCE(SUM(output_tokens), 0),
		        COALESCE(SUM(estimated_cost_usd), 0)
		 FROM pico_usage
		 WHERE last_seen >= ?
		 GROUP BY model
		 ORDER BY model`,
		monthStart,
	)
	if err != nil {
		return totals, err
	}
	defer modelRows.Close()
	for modelRows.Next() {
		var m PicoUsageSummary
		if err := modelRows.Scan(&m.Model, &m.Requests, &m.InputTokens, &m.OutputTokens, &m.EstimatedCostUsd); err != nil {
			return totals, err
		}
		m.TotalTokens = m.InputTokens + m.OutputTokens
		totals.ByModel = append(totals.ByModel, m)
		totals.Requests += m.Requests
		totals.InputTokens += m.InputTokens
		totals.OutputTokens += m.OutputTokens
		totals.TotalTokens += m.TotalTokens
		totals.EstimatedCostUsd += m.EstimatedCostUsd
	}
	if err := modelRows.Err(); err != nil {
		return totals, err
	}
	return totals, nil
}

// List returns messages for a session ordered oldest->newest.
// If beforeID > 0, returns messages with id < beforeID (for pagination),
// newest N first then reversed to ascending, matching timeline semantics.
func (s *PicoHistoryStore) List(
	ctx context.Context,
	sessionID string,
	beforeID int64,
	limit int,
) ([]PicoHistoryMessage, error) {
	if s == nil || s.db == nil {
		return nil, nil
	}
	if limit <= 0 || limit > 200 {
		limit = 30
	}
	var rows *sql.Rows
	var err error
	if beforeID > 0 {
		rows, err = s.db.QueryContext(
			ctx,
			`SELECT id, session_id, role, content, model, kind, created_at
			 FROM pico_messages
			 WHERE session_id = ? AND id < ?
			 ORDER BY id DESC LIMIT ?`,
			sessionID, beforeID, limit,
		)
	} else {
		rows, err = s.db.QueryContext(
			ctx,
			`SELECT id, session_id, role, content, model, kind, created_at
			 FROM pico_messages
			 WHERE session_id = ?
			 ORDER BY id DESC LIMIT ?`,
			sessionID, limit,
		)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]PicoHistoryMessage, 0, limit)
	for rows.Next() {
		var m PicoHistoryMessage
		if err := rows.Scan(
			&m.ID, &m.SessionID, &m.Role, &m.Content, &m.Model, &m.Kind, &m.CreatedAt,
		); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// reverse to ascending
	for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
		out[i], out[j] = out[j], out[i]
	}
	return out, nil
}

// HasMore reports whether older messages exist before the given id.
func (s *PicoHistoryStore) HasMore(ctx context.Context, sessionID string, beforeID int64) (bool, error) {
	if s == nil || s.db == nil {
		return false, nil
	}
	var one int
	err := s.db.QueryRowContext(
		ctx,
		`SELECT 1 FROM pico_messages WHERE session_id = ? AND id < ? LIMIT 1`,
		sessionID, beforeID,
	).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// Close releases the database handle.
func (s *PicoHistoryStore) Close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}
