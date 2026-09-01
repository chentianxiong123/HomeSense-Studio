package pico

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

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
`

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
	if _, err := db.Exec(picoHistorySchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("pico history: schema: %w", err)
	}
	return &PicoHistoryStore{db: db}, nil
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
