// User metadata store. Each registered user owns a personal SQLite database
// (created at registration time, per the v6 "one user, one store" model) and a
// workspace directory. Agent *instances* are NOT created here — that happens
// lazily on first message via the AgentLoop registry.

package main

import (
	"database/sql"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "modernc.org/sqlite"
)

// User is a registered tenant row in the v6 meta DB.
type User struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Workspace string    `json:"workspace"`
	Model     string    `json:"model,omitempty"`
	APIKey    string    `json:"-"` // per-user new-api token (never serialized)
	CreatedAt time.Time `json:"created_at"`
}

// Store persists the user→agent mapping and manages per-user SQLite files.
type Store struct {
	db        *sql.DB
	dataDir   string
	corpusDir string
}

// NewStore opens (or creates) the v6 meta database and ensures the data dirs
// exist.
func NewStore(dataDir, corpusDir string) (*Store, error) {
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		return nil, err
	}
	metaPath := filepath.Join(dataDir, "v6-meta.db")
	db, err := sql.Open("sqlite", metaPath+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(`
		CREATE TABLE IF NOT EXISTS users (
			id        TEXT PRIMARY KEY,
			name      TEXT NOT NULL DEFAULT '',
			workspace TEXT NOT NULL,
			model     TEXT NOT NULL DEFAULT '',
			api_key   TEXT NOT NULL DEFAULT '',
			created_at TIMESTAMP NOT NULL
		);
	`); err != nil {
		db.Close()
		return nil, fmt.Errorf("create users table: %w", err)
	}
	return &Store{db: db, dataDir: dataDir, corpusDir: corpusDir}, nil
}

// Close releases the meta database handle.
func (s *Store) Close() error { return s.db.Close() }

// RegisterUser creates a user row, its personal SQLite database, and its
// workspace directory. No agent instance is created yet (lazy warm-up).
func (s *Store) RegisterUser(id, name, model, apiKey string) (User, error) {
	if id == "" {
		return User{}, errors.New("user id is required")
	}

	wsDir := filepath.Join(s.dataDir, "users", id)
	if err := os.MkdirAll(wsDir, 0o755); err != nil {
		return User{}, err
	}
	// Personal SQLite database created at registration.
	personalDB := filepath.Join(wsDir, "user.db")
	db, err := sql.Open("sqlite", personalDB+"?_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)")
	if err != nil {
		return User{}, err
	}
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`); err != nil {
		db.Close()
		return User{}, err
	}
	if _, err := db.Exec(`INSERT OR REPLACE INTO meta (k, v) VALUES ('created_at', ?)`, time.Now().UTC().Format(time.RFC3339)); err != nil {
		db.Close()
		return User{}, err
	}
	if err := db.Close(); err != nil {
		return User{}, err
	}

	if err := seedWorkspaceFiles(wsDir, s.corpusDir); err != nil {
		return User{}, err
	}

	u := User{
		ID:        id,
		Name:      name,
		Workspace: wsDir,
		Model:     model,
		APIKey:    apiKey,
		CreatedAt: time.Now().UTC(),
	}
	_, err = s.db.Exec(
		`INSERT INTO users (id, name, workspace, model, api_key, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
		u.ID, u.Name, u.Workspace, u.Model, u.APIKey, u.CreatedAt,
	)
	if err != nil {
		return User{}, fmt.Errorf("insert user: %w", err)
	}
	return u, nil
}

// GetUser returns a user row by ID.
func (s *Store) GetUser(id string) (User, error) {
	row := s.db.QueryRow(
		`SELECT id, name, workspace, model, api_key, created_at FROM users WHERE id = ?`, id)
	var u User
	if err := row.Scan(&u.ID, &u.Name, &u.Workspace, &u.Model, &u.APIKey, &u.CreatedAt); err != nil {
		return User{}, err
	}
	return u, nil
}

// ListUsers returns all registered users.
func (s *Store) ListUsers() ([]User, error) {
	rows, err := s.db.Query(
		`SELECT id, name, workspace, model, api_key, created_at FROM users ORDER BY created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var users []User
	for rows.Next() {
		var u User
		if err := rows.Scan(&u.ID, &u.Name, &u.Workspace, &u.Model, &u.APIKey, &u.CreatedAt); err != nil {
			return nil, err
		}
		users = append(users, u)
	}
	return users, rows.Err()
}

// RemoveUser deletes a user row (workspace/personal DB are left on disk by
// design; the control plane calls registry.RemoveUserAgent separately).
func (s *Store) RemoveUser(id string) error {
	_, err := s.db.Exec(`DELETE FROM users WHERE id = ?`, id)
	return err
}
