// Real session listing/history backed by each user's SQLite session store.
//
// Sessions are persisted by the per-user agent runtime into
// data/users/<userID>/sessions/sessions.db. These handlers authenticate the
// caller, open that database read-write (WAL allows a second connection
// alongside the live agent), and surface summaries/history/delete to the web
// UI so refreshes restore the conversation.

package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/providers"
	_ "modernc.org/sqlite"
)

var errUnauthorized = errors.New("unauthorized")

// userIDFromRequest resolves the authenticated user for a request.
func (s *Server) userIDFromRequest(r *http.Request) (string, error) {
	token := bearerToken(r)
	if token == "" {
		return "", errUnauthorized
	}
	st, ok := s.sessions.lookup(token)
	if !ok {
		return "", errUnauthorized
	}
	return st.userID, nil
}

// userSessionsPath returns the per-user SQLite sessions database path.
func (s *Server) userSessionsPath(userID string) string {
	return filepath.Join(s.cfg.DataDir, "users", userID, "sessions", "sessions.db")
}

// openUserSessionsDB opens a user's session database for read/write access.
func openUserSessionsDB(path string) (*sql.DB, error) {
	db, err := sql.Open("sqlite", path+"?_pragma=busy_timeout(10000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

type sessionSummary struct {
	ID           string `json:"id"`
	Title        string `json:"title"`
	Preview      string `json:"preview"`
	MessageCount int    `json:"message_count"`
	Created      string `json:"created"`
	Updated      string `json:"updated"`
}

// handleSessions lists or creates sessions for the authenticated user.
func (s *Server) handleSessions(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		userID, err := s.userIDFromRequest(r)
		if err != nil {
			respondErr(w, http.StatusUnauthorized, "invalid or missing token")
			return
		}
		offset := queryInt(r, "offset", 0)
		limit := queryInt(r, "limit", 20)
		if offset < 0 {
			offset = 0
		}
		if limit <= 0 || limit > 100 {
			limit = 20
		}

		summaries, err := s.listUserSessions(userID, offset, limit)
		if err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, summaries)

	case http.MethodPost:
		// New chat sessions are identified by a client-generated session id;
		// nothing is persisted server-side until the first message arrives.
		if _, err := s.userIDFromRequest(r); err != nil {
			respondErr(w, http.StatusUnauthorized, "invalid or missing token")
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// handleSessionByID loads (GET) or deletes (DELETE) a single session.
func (s *Server) handleSessionByID(w http.ResponseWriter, r *http.Request) {
	userID, err := s.userIDFromRequest(r)
	if err != nil {
		respondErr(w, http.StatusUnauthorized, "invalid or missing token")
		return
	}
	id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/api/sessions/"), "/")
	if id == "" {
		respondErr(w, http.StatusBadRequest, "session id required")
		return
	}

	switch r.Method {
	case http.MethodGet:
		detail, err := s.loadUserSession(userID, id)
		if err != nil {
			respondErr(w, http.StatusNotFound, "session not found")
			return
		}
		respondJSON(w, http.StatusOK, detail)

	case http.MethodDelete:
		if err := s.deleteUserSession(userID, id); err != nil {
			respondErr(w, http.StatusNotFound, "session not found")
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		w.WriteHeader(http.StatusMethodNotAllowed)
	}
}

// listUserSessions returns session summaries ordered by most-recent activity.
func (s *Server) listUserSessions(userID string, offset, limit int) ([]sessionSummary, error) {
	path := s.userSessionsPath(userID)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return []sessionSummary{}, nil
	}
	db, err := openUserSessionsDB(path)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	rows, err := db.Query(
		`SELECT key, summary, skip, count, created_at, updated_at
		 FROM sessions ORDER BY updated_at DESC, key LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, err
	}

	// Collect rows before closing the cursor: with MaxOpenConns(1) the
	// single connection is held while rows are open, so nested queries
	// below must run only after rows.Close().
	type row struct {
		key, summary     string
		skip, count      int64
		created, updated int64
	}
	var collected []row
	for rows.Next() {
		var r row
		if err := rows.Scan(&r.key, &r.summary, &r.skip, &r.count, &r.created, &r.updated); err != nil {
			rows.Close()
			return nil, err
		}
		collected = append(collected, r)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, err
	}
	rows.Close()

	summaries := []sessionSummary{}
	for _, r := range collected {
		var title, preview string
		_ = db.QueryRow(
			`SELECT content FROM messages WHERE session_key = ? AND seq > ? AND role = 'user'
			 ORDER BY seq LIMIT 1`, r.key, r.skip,
		).Scan(&title)
		_ = db.QueryRow(
			`SELECT content FROM messages WHERE session_key = ? AND seq > ?
			 ORDER BY seq DESC LIMIT 1`, r.key, r.skip,
		).Scan(&preview)

		title = strings.TrimSpace(title)
		if title == "" {
			title = strings.TrimSpace(r.summary)
		}
		if title == "" {
			title = "(新对话)"
		}
		if len([]rune(title)) > 60 {
			title = string([]rune(title)[:60])
		}
		if len([]rune(preview)) > 120 {
			preview = string([]rune(preview)[:120])
		}

		summaries = append(summaries, sessionSummary{
			ID:           r.key,
			Title:        title,
			Preview:      strings.TrimSpace(preview),
			MessageCount: int(r.count - r.skip),
			Created:      fmtRFC3339(r.created),
			Updated:      fmtRFC3339(r.updated),
		})
	}
	return summaries, nil
}

type sessionDetailMessage struct {
	Role        string                 `json:"role"`
	Content     string                 `json:"content"`
	CreatedAt   string                 `json:"created_at,omitempty"`
	Kind        string                 `json:"kind,omitempty"`
	ModelName   string                 `json:"model_name,omitempty"`
	Media       []string               `json:"media,omitempty"`
	Attachments []providers.Attachment `json:"attachments,omitempty"`
	ToolCalls   []providers.ToolCall   `json:"tool_calls,omitempty"`
}

// loadUserSession returns the full message history for one session.
func (s *Server) loadUserSession(userID, id string) (map[string]any, error) {
	path := s.userSessionsPath(userID)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, os.ErrNotExist
	}
	db, err := openUserSessionsDB(path)
	if err != nil {
		return nil, err
	}
	defer db.Close()

	var summary string
	var skip, created, updated int64
	err = db.QueryRow(
		`SELECT summary, skip, created_at, updated_at FROM sessions WHERE key = ?`, id,
	).Scan(&summary, &skip, &created, &updated)
	if err == sql.ErrNoRows {
		return nil, os.ErrNotExist
	}
	if err != nil {
		return nil, err
	}

	rows, err := db.Query(
		`SELECT payload FROM messages WHERE session_key = ? AND seq > ? ORDER BY seq`, id, skip,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	messages := []sessionDetailMessage{}
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			return nil, err
		}
		var msg providers.Message
		if err := json.Unmarshal([]byte(payload), &msg); err != nil {
			continue
		}
		kind := "normal"
		if len(msg.ToolCalls) > 0 {
			kind = "tool_calls"
		} else if strings.TrimSpace(msg.Content) == "" && strings.TrimSpace(msg.ReasoningContent) != "" {
			kind = "thought"
		}
		createdAt := ""
		if msg.CreatedAt != nil {
			createdAt = msg.CreatedAt.UTC().Format(time.RFC3339)
		}
		messages = append(messages, sessionDetailMessage{
			Role:        msg.Role,
			Content:     msg.Content,
			CreatedAt:   createdAt,
			Kind:        kind,
			ModelName:   msg.ModelName,
			Media:       msg.Media,
			Attachments: msg.Attachments,
			ToolCalls:   msg.ToolCalls,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return map[string]any{
		"id":       id,
		"messages": messages,
		"summary":  summary,
		"created":  fmtRFC3339(created),
		"updated":  fmtRFC3339(updated),
	}, nil
}

// deleteUserSession removes a session's rows and metadata.
func (s *Server) deleteUserSession(userID, id string) error {
	path := s.userSessionsPath(userID)
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return os.ErrNotExist
	}
	db, err := openUserSessionsDB(path)
	if err != nil {
		return err
	}
	defer db.Close()

	var exists int
	if err := db.QueryRow(`SELECT COUNT(*) FROM sessions WHERE key = ?`, id).Scan(&exists); err != nil {
		return err
	}
	if exists == 0 {
		return os.ErrNotExist
	}
	statements := []struct {
		q    string
		args []any
	}{
		{`DELETE FROM messages WHERE session_key = ?`, []any{id}},
		{`DELETE FROM sessions WHERE key = ?`, []any{id}},
		{`DELETE FROM session_aliases WHERE canonical = ? OR alias = ?`, []any{id, id}},
	}
	for _, st := range statements {
		if _, err := db.Exec(st.q, st.args...); err != nil {
			return err
		}
	}
	return nil
}

func queryInt(r *http.Request, key string, def int) int {
	raw := r.URL.Query().Get(key)
	if raw == "" {
		return def
	}
	v, err := strconv.Atoi(raw)
	if err != nil {
		return def
	}
	return v
}

func fmtRFC3339(sec int64) string {
	if sec <= 0 {
		return time.Now().UTC().Format(time.RFC3339)
	}
	return time.Unix(sec, 0).UTC().Format(time.RFC3339)
}
