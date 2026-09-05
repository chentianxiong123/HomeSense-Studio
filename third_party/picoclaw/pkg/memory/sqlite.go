package memory

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/providers"
	"github.com/sipeed/picoclaw/pkg/providers/messageutil"
	_ "modernc.org/sqlite"
)

// SQLiteStore implements Store using a single SQLite database file.
//
// Schema:
//
//	messages        — one row per message (full providers.Message JSON in payload)
//	sessions        — per-session metadata (summary, skip offset, scope, aliases)
//	session_aliases — alias -> canonical key mapping for ResolveSessionKey
//
// Logical truncation mirrors the JSONL store: messages are never deleted by
// TruncateHistory, which instead advances a "skip" offset stored in the
// sessions table. Compact physically removes rows below that offset.
//
// The store is per-agent: each AgentInstance opens its own database file at
// <workspace>/sessions/sessions.db, so multi-user isolation is structural.
type SQLiteStore struct {
	dir string
	db  *sql.DB
}

const sqliteSchema = `
CREATE TABLE IF NOT EXISTS messages (
	session_key TEXT NOT NULL,
	seq         INTEGER NOT NULL,
	role        TEXT NOT NULL,
	content     TEXT NOT NULL,
	payload     TEXT NOT NULL,
	created_at  INTEGER NOT NULL,
	PRIMARY KEY (session_key, seq)
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_key, seq);

CREATE TABLE IF NOT EXISTS sessions (
	key        TEXT PRIMARY KEY,
	summary    TEXT NOT NULL DEFAULT '',
	skip       INTEGER NOT NULL DEFAULT 0,
	count      INTEGER NOT NULL DEFAULT 0,
	created_at INTEGER NOT NULL DEFAULT 0,
	updated_at INTEGER NOT NULL DEFAULT 0,
	scope      TEXT,
	aliases    TEXT
);

CREATE TABLE IF NOT EXISTS session_aliases (
	alias     TEXT PRIMARY KEY,
	canonical TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_aliases_canonical ON session_aliases(canonical);
`

// NewSQLiteStore creates a SQLite-backed store rooted at dir. The database
// file is <dir>/sessions.db and the directory is created if missing.
func NewSQLiteStore(dir string) (*SQLiteStore, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, fmt.Errorf("memory: create directory: %w", err)
	}
	path := filepath.Join(dir, "sessions.db")
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)&_pragma=synchronous(NORMAL)")
	if err != nil {
		return nil, fmt.Errorf("memory: open sqlite: %w", err)
	}
	// A single connection serializes all access, which matches the
	// per-session mutex semantics of the JSONL store while keeping
	// read-modify-write operations trivially atomic within transactions.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec(sqliteSchema); err != nil {
		db.Close()
		return nil, fmt.Errorf("memory: init sqlite schema: %w", err)
	}
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, fmt.Errorf("memory: ping sqlite: %w", err)
	}
	return &SQLiteStore{dir: dir, db: db}, nil
}

func (s *SQLiteStore) dbPath() string {
	return filepath.Join(s.dir, "sessions.db")
}

// tx runs fn inside a transaction. With MaxOpenConns(1) the underlying
// connection is always available, so Begin never needs to wait.
func (s *SQLiteStore) tx(fn func(tx *sql.Tx) error) error {
	tx, err := s.db.Begin()
	if err != nil {
		return fmt.Errorf("memory: begin: %w", err)
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (s *SQLiteStore) loadMeta(tx *sql.Tx, key string) (SessionMeta, error) {
	meta := SessionMeta{Key: key}
	var created, updated int64
	var scopeText, aliasesText string
	err := tx.QueryRow(
		`SELECT summary, skip, count, created_at, updated_at, COALESCE(scope,''), COALESCE(aliases,'')
		 FROM sessions WHERE key = ?`, key,
	).Scan(&meta.Summary, &meta.Skip, &meta.Count, &created, &updated,
		&scopeText, &aliasesText)
	if err == sql.ErrNoRows {
		return meta, nil
	}
	if err != nil {
		return SessionMeta{}, fmt.Errorf("memory: read meta: %w", err)
	}
	if scopeText != "" {
		meta.Scope = json.RawMessage(scopeText)
	}
	if aliasesText != "" {
		if err := json.Unmarshal([]byte(aliasesText), &meta.Aliases); err != nil {
			return SessionMeta{}, fmt.Errorf("memory: decode aliases: %w", err)
		}
	}
	if created > 0 {
		meta.CreatedAt = time.Unix(created, 0)
	}
	if updated > 0 {
		meta.UpdatedAt = time.Unix(updated, 0)
	}
	return meta, nil
}

func (s *SQLiteStore) saveMeta(tx *sql.Tx, key string, meta SessionMeta) error {
	var scope any
	if len(meta.Scope) > 0 {
		scope = string(meta.Scope)
	}
	var aliases any
	if len(meta.Aliases) > 0 {
		data, err := json.Marshal(meta.Aliases)
		if err != nil {
			return fmt.Errorf("memory: encode aliases: %w", err)
		}
		aliases = string(data)
	}
	createdAt := int64(0)
	if !meta.CreatedAt.IsZero() {
		createdAt = meta.CreatedAt.Unix()
	}
	updatedAt := int64(0)
	if !meta.UpdatedAt.IsZero() {
		updatedAt = meta.UpdatedAt.Unix()
	}
	_, err := tx.Exec(
		`INSERT INTO sessions (key, summary, skip, count, created_at, updated_at, scope, aliases)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET
		   summary = excluded.summary,
		   skip    = excluded.skip,
		   count   = excluded.count,
		   updated_at = excluded.updated_at,
		   scope   = excluded.scope,
		   aliases = excluded.aliases`,
		key, meta.Summary, meta.Skip, meta.Count,
		createdAt, updatedAt, scope, aliases,
	)
	if err != nil {
		return fmt.Errorf("memory: write meta: %w", err)
	}
	return nil
}

func (s *SQLiteStore) nextSeq(tx *sql.Tx, key string) (int, error) {
	var seq int
	err := tx.QueryRow(`SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE session_key = ?`, key).Scan(&seq)
	if err != nil {
		return 0, fmt.Errorf("memory: next seq: %w", err)
	}
	return seq, nil
}

func (s *SQLiteStore) replaceAliases(tx *sql.Tx, key string, aliases []string) error {
	if _, err := tx.Exec(`DELETE FROM session_aliases WHERE canonical = ?`, key); err != nil {
		return fmt.Errorf("memory: clear aliases: %w", err)
	}
	for _, alias := range aliases {
		if _, err := tx.Exec(
			`INSERT OR REPLACE INTO session_aliases (alias, canonical) VALUES (?, ?)`,
			alias, key,
		); err != nil {
			return fmt.Errorf("memory: insert alias: %w", err)
		}
	}
	return nil
}

// AddMessage appends a simple text message to a session.
func (s *SQLiteStore) AddMessage(_ context.Context, sessionKey, role, content string) error {
	return s.addMsg(sessionKey, providers.Message{Role: role, Content: content})
}

// AddFullMessage appends a complete message (with tool calls, etc.) to a session.
func (s *SQLiteStore) AddFullMessage(_ context.Context, sessionKey string, msg providers.Message) error {
	return s.addMsg(sessionKey, msg)
}

func (s *SQLiteStore) addMsg(sessionKey string, msg providers.Message) error {
	if messageutil.IsTransientAssistantThoughtMessage(msg) {
		return nil
	}
	if strings.TrimSpace(sessionKey) == "" {
		return fmt.Errorf("memory: empty session key")
	}

	now := time.Now()
	if msg.CreatedAt == nil {
		msg.CreatedAt = &now
	}
	payload, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("memory: marshal message: %w", err)
	}

	return s.tx(func(tx *sql.Tx) error {
		meta, err := s.loadMeta(tx, sessionKey)
		if err != nil {
			return err
		}
		seq, err := s.nextSeq(tx, sessionKey)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(
			`INSERT INTO messages (session_key, seq, role, content, payload, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			sessionKey, seq, msg.Role, msg.Content, string(payload), now.Unix(),
		); err != nil {
			return fmt.Errorf("memory: append message: %w", err)
		}

		if meta.Count == 0 && meta.CreatedAt.IsZero() {
			meta.CreatedAt = now
		}
		meta.Count++
		meta.UpdatedAt = now
		return s.saveMeta(tx, sessionKey, meta)
	})
}

// GetHistory returns all messages for a session in insertion order.
// Returns an empty slice (not nil) if the session does not exist.
func (s *SQLiteStore) GetHistory(_ context.Context, sessionKey string) ([]providers.Message, error) {
	return s.txRead(func(tx *sql.Tx) ([]providers.Message, error) {
		meta, err := s.loadMeta(tx, sessionKey)
		if err != nil {
			return nil, err
		}
		return s.readHistory(tx, sessionKey, meta.Skip)
	})
}

func (s *SQLiteStore) readHistory(tx *sql.Tx, sessionKey string, skip int) ([]providers.Message, error) {
	rows, err := tx.Query(
		`SELECT payload FROM messages WHERE session_key = ? AND seq > ? ORDER BY seq`,
		sessionKey, skip,
	)
	if err != nil {
		return nil, fmt.Errorf("memory: query history: %w", err)
	}
	defer rows.Close()

	var msgs []providers.Message
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, fmt.Errorf("memory: scan history: %w", err)
		}
		var msg providers.Message
		if err := json.Unmarshal([]byte(payload), &msg); err != nil {
			log.Printf("memory: skipping corrupt message row for %s: %v", sessionKey, err)
			continue
		}
		if messageutil.IsTransientAssistantThoughtMessage(msg) {
			continue
		}
		msgs = append(msgs, msg)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("memory: iterate history: %w", err)
	}
	if msgs == nil {
		msgs = []providers.Message{}
	}
	return msgs, nil
}

func (s *SQLiteStore) txRead(fn func(tx *sql.Tx) ([]providers.Message, error)) ([]providers.Message, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, fmt.Errorf("memory: begin: %w", err)
	}
	defer tx.Rollback()
	return fn(tx)
}

// GetSummary returns the conversation summary for a session.
func (s *SQLiteStore) GetSummary(_ context.Context, sessionKey string) (string, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return "", fmt.Errorf("memory: begin: %w", err)
	}
	defer tx.Rollback()
	meta, err := s.loadMeta(tx, sessionKey)
	if err != nil {
		return "", err
	}
	return meta.Summary, nil
}

// SetSummary updates the conversation summary for a session.
func (s *SQLiteStore) SetSummary(_ context.Context, sessionKey, summary string) error {
	return s.tx(func(tx *sql.Tx) error {
		meta, err := s.loadMeta(tx, sessionKey)
		if err != nil {
			return err
		}
		now := time.Now()
		if meta.CreatedAt.IsZero() {
			meta.CreatedAt = now
		}
		meta.Summary = summary
		meta.UpdatedAt = now
		return s.saveMeta(tx, sessionKey, meta)
	})
}

// TruncateHistory removes all but the last keepLast messages from a session.
// It advances the skip offset without deleting rows (logical truncation).
func (s *SQLiteStore) TruncateHistory(_ context.Context, sessionKey string, keepLast int) error {
	return s.tx(func(tx *sql.Tx) error {
		meta, err := s.loadMeta(tx, sessionKey)
		if err != nil {
			return err
		}
		if meta.Skip > meta.Count {
			meta.Skip = meta.Count
		}
		activeRetainedCount := meta.Count - meta.Skip

		switch {
		case keepLast <= 0 || activeRetainedCount == 0:
			meta.Skip = meta.Count
		case keepLast < activeRetainedCount:
			var seq int
			if err := tx.QueryRow(
				`SELECT seq FROM messages WHERE session_key = ? AND seq > ?
				 ORDER BY seq LIMIT 1 OFFSET ?`,
				sessionKey, meta.Skip, activeRetainedCount-keepLast-1,
			).Scan(&seq); err != nil {
				return fmt.Errorf("memory: truncate seq: %w", err)
			}
			meta.Skip = seq
		}
		meta.UpdatedAt = time.Now()
		return s.saveMeta(tx, sessionKey, meta)
	})
}

// SetHistory replaces all messages in a session with the provided history.
func (s *SQLiteStore) SetHistory(_ context.Context, sessionKey string, history []providers.Message) error {
	history = messageutil.FilterInvalidHistoryMessages(history)
	return s.tx(func(tx *sql.Tx) error {
		meta, err := s.loadMeta(tx, sessionKey)
		if err != nil {
			return err
		}
		now := time.Now()
		if meta.CreatedAt.IsZero() {
			meta.CreatedAt = now
		}
		meta.Skip = 0
		meta.Count = len(history)
		meta.UpdatedAt = now

		if _, err := tx.Exec(`DELETE FROM messages WHERE session_key = ?`, sessionKey); err != nil {
			return fmt.Errorf("memory: clear history: %w", err)
		}
		for i, msg := range history {
			if msg.CreatedAt == nil {
				msg.CreatedAt = &now
			}
			payload, err := json.Marshal(msg)
			if err != nil {
				return fmt.Errorf("memory: marshal message %d: %w", i, err)
			}
			if _, err := tx.Exec(
				`INSERT INTO messages (session_key, seq, role, content, payload, created_at)
				 VALUES (?, ?, ?, ?, ?, ?)`,
				sessionKey, i+1, msg.Role, msg.Content, string(payload), msg.CreatedAt.Unix(),
			); err != nil {
				return fmt.Errorf("memory: insert history message: %w", err)
			}
		}
		return s.saveMeta(tx, sessionKey, meta)
	})
}

// Compact physically removes logically truncated rows and resets the offset.
func (s *SQLiteStore) Compact(_ context.Context, sessionKey string) error {
	return s.tx(func(tx *sql.Tx) error {
		meta, err := s.loadMeta(tx, sessionKey)
		if err != nil {
			return err
		}
		if meta.Skip == 0 {
			return nil
		}
		if _, err := tx.Exec(
			`DELETE FROM messages WHERE session_key = ? AND seq <= ?`,
			sessionKey, meta.Skip,
		); err != nil {
			return fmt.Errorf("memory: compact messages: %w", err)
		}
		var count int
		if err := tx.QueryRow(
			`SELECT COUNT(*) FROM messages WHERE session_key = ?`, sessionKey,
		).Scan(&count); err != nil {
			return fmt.Errorf("memory: count after compact: %w", err)
		}
		meta.Skip = 0
		meta.Count = count
		meta.UpdatedAt = time.Now()
		return s.saveMeta(tx, sessionKey, meta)
	})
}

// ListSessions returns all known session keys.
func (s *SQLiteStore) ListSessions() []string {
	rows, err := s.db.Query(`SELECT key FROM sessions`)
	if err != nil {
		return nil
	}
	defer rows.Close()
	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			continue
		}
		keys = append(keys, key)
	}
	return keys
}

// Close releases the underlying database handle.
func (s *SQLiteStore) Close() error {
	if s.db == nil {
		return nil
	}
	return s.db.Close()
}

// GetSessionMeta returns the current metadata snapshot for sessionKey.
func (s *SQLiteStore) GetSessionMeta(_ context.Context, sessionKey string) (SessionMeta, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return SessionMeta{}, fmt.Errorf("memory: begin: %w", err)
	}
	defer tx.Rollback()

	meta, err := s.loadMeta(tx, sessionKey)
	if err != nil {
		return SessionMeta{}, err
	}
	meta.Scope = cloneRawJSON(meta.Scope)
	if len(meta.Aliases) > 0 {
		meta.Aliases = append([]string(nil), meta.Aliases...)
	}
	return meta, nil
}

// UpsertSessionMeta stores structured session metadata while preserving
// summary/count/skip timestamps maintained by the core store.
func (s *SQLiteStore) UpsertSessionMeta(
	_ context.Context,
	sessionKey string,
	scope json.RawMessage,
	aliases []string,
) error {
	if strings.TrimSpace(sessionKey) == "" {
		return fmt.Errorf("memory: empty session key")
	}
	aliases = normalizeAliases(sessionKey, aliases)
	return s.tx(func(tx *sql.Tx) error {
		meta, err := s.loadMeta(tx, sessionKey)
		if err != nil {
			return err
		}
		meta.Scope = cloneRawJSON(scope)
		meta.Aliases = aliases
		now := time.Now()
		if meta.CreatedAt.IsZero() {
			meta.CreatedAt = now
		}
		meta.UpdatedAt = now
		if err := s.saveMeta(tx, sessionKey, meta); err != nil {
			return err
		}
		return s.replaceAliases(tx, sessionKey, aliases)
	})
}

// PromoteAliasHistory atomically promotes the first non-empty alias session
// into the canonical session when the canonical session is still empty.
func (s *SQLiteStore) PromoteAliasHistory(
	_ context.Context,
	sessionKey string,
	scope json.RawMessage,
	aliases []string,
) (bool, error) {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return false, nil
	}
	aliases = normalizeAliases(sessionKey, aliases)

	return s.txBool(func(tx *sql.Tx) (bool, error) {
		canonical, err := s.loadMeta(tx, sessionKey)
		if err != nil {
			return false, err
		}
		hasContent, err := s.sessionHasVisibleContent(tx, sessionKey, canonical)
		if err != nil {
			return false, err
		}
		if hasContent {
			return false, nil
		}

		for _, alias := range aliases {
			if isMainSessionAlias(alias) {
				continue
			}
			promoted, err := s.promoteAliasHistoryLocked(tx, sessionKey, alias, scope, aliases)
			if err != nil || promoted {
				return promoted, err
			}
		}
		return false, nil
	})
}

func (s *SQLiteStore) promoteAliasHistoryLocked(
	tx *sql.Tx,
	sessionKey, alias string,
	scope json.RawMessage,
	aliases []string,
) (bool, error) {
	aliasMeta, err := s.loadMeta(tx, alias)
	if err != nil {
		return false, err
	}
	aliasHistory, err := s.readHistory(tx, alias, aliasMeta.Skip)
	if err != nil {
		return false, err
	}
	aliasSummary := strings.TrimSpace(aliasMeta.Summary)
	if len(aliasHistory) == 0 && aliasSummary == "" {
		return false, nil
	}

	now := time.Now()
	canonical := SessionMeta{Key: sessionKey}
	canonical.Scope = cloneRawJSON(scope)
	canonical.Aliases = normalizeAliases(sessionKey, aliases)
	canonical.Skip = 0
	canonical.Count = len(aliasHistory)
	canonical.CreatedAt = now
	canonical.UpdatedAt = now
	if aliasSummary != "" {
		canonical.Summary = aliasSummary
	}

	if _, err := tx.Exec(`DELETE FROM messages WHERE session_key = ?`, sessionKey); err != nil {
		return false, fmt.Errorf("memory: clear canonical: %w", err)
	}
	for i, msg := range aliasHistory {
		if msg.CreatedAt == nil {
			msg.CreatedAt = &now
		}
		payload, err := json.Marshal(msg)
		if err != nil {
			return false, fmt.Errorf("memory: marshal message %d: %w", i, err)
		}
		if _, err := tx.Exec(
			`INSERT INTO messages (session_key, seq, role, content, payload, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			sessionKey, i+1, msg.Role, msg.Content, string(payload), msg.CreatedAt.Unix(),
		); err != nil {
			return false, fmt.Errorf("memory: insert promoted message: %w", err)
		}
	}
	if err := s.saveMeta(tx, sessionKey, canonical); err != nil {
		return false, err
	}
	return true, nil
}

func (s *SQLiteStore) sessionHasVisibleContent(tx *sql.Tx, sessionKey string, meta SessionMeta) (bool, error) {
	if strings.TrimSpace(meta.Summary) != "" {
		return true, nil
	}
	history, err := s.readHistory(tx, sessionKey, meta.Skip)
	if err != nil {
		return false, err
	}
	return len(history) > 0, nil
}

// ResolveSessionKey returns the canonical session key for a candidate key.
func (s *SQLiteStore) ResolveSessionKey(_ context.Context, sessionKey string) (string, bool, error) {
	sessionKey = strings.TrimSpace(sessionKey)
	if sessionKey == "" {
		return "", false, nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return "", false, fmt.Errorf("memory: begin: %w", err)
	}
	defer tx.Rollback()

	var directExists int
	if err := tx.QueryRow(
		`SELECT COUNT(*) FROM sessions WHERE key = ?`, sessionKey,
	).Scan(&directExists); err != nil {
		return "", false, fmt.Errorf("memory: query session: %w", err)
	}
	if directExists > 0 && shouldShortCircuitSessionResolve(sessionKey) {
		return sessionKey, true, nil
	}

	var canonical string
	err = tx.QueryRow(
		`SELECT canonical FROM session_aliases WHERE alias = ?`, sessionKey,
	).Scan(&canonical)
	if err == nil {
		if canonical != "" && canonical != sessionKey {
			return canonical, true, nil
		}
	} else if err != sql.ErrNoRows {
		return "", false, fmt.Errorf("memory: query alias: %w", err)
	}

	if directExists > 0 {
		return sessionKey, true, nil
	}
	return "", false, nil
}

func (s *SQLiteStore) txBool(fn func(tx *sql.Tx) (bool, error)) (bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return false, fmt.Errorf("memory: begin: %w", err)
	}
	ok, err := fn(tx)
	if err != nil {
		tx.Rollback()
		return false, err
	}
	if err := tx.Commit(); err != nil {
		return false, fmt.Errorf("memory: commit: %w", err)
	}
	return ok, nil
}
