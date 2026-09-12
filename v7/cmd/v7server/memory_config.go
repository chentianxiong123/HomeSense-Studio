// Per-tenant memory configuration.
//
// Each user can customise memory behaviour via a memory.json file stored
// alongside their workspace. The config controls:
//   - whether long-term memory (MEMORY.md) is active
//   - whether daily notes are recorded and how many days are injected
//   - whether the history_search tool is available
//
// The file is optional; absent fields fall back to defaults.

package main

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
)

// DailyNotesConfig controls daily note behaviour.
type DailyNotesConfig struct {
	Enabled        bool `json:"enabled"`
	RetentionDays  int  `json:"retention_days"`
}

// HistorySearchConfig controls the history_search tool.
type HistorySearchConfig struct {
	Enabled    bool `json:"enabled"`
	MaxResults int  `json:"max_results"`
}

// MemoryConfig is the full memory configuration for a tenant.
type MemoryConfig struct {
	Enabled       bool                `json:"enabled"`
	DailyNotes    DailyNotesConfig    `json:"daily_notes"`
	HistorySearch HistorySearchConfig `json:"history_search"`
}

// DefaultMemoryConfig returns the production defaults.
func DefaultMemoryConfig() MemoryConfig {
	return MemoryConfig{
		Enabled: true,
		DailyNotes: DailyNotesConfig{
			Enabled:       true,
			RetentionDays: 3,
		},
		HistorySearch: HistorySearchConfig{
			Enabled:    true,
			MaxResults: 8,
		},
	}
}

// memoryConfigPath returns the path to <workspace>/memory.json.
func memoryConfigPath(workspace string) string {
	return filepath.Join(workspace, "memory.json")
}

// LoadMemoryConfig reads the tenant's memory.json. If the file does not exist
// or is empty, DefaultMemoryConfig is returned. Partial files are merged with
// defaults so that new fields are automatically backfilled.
func LoadMemoryConfig(workspace string) MemoryConfig {
	cfg := DefaultMemoryConfig()

	data, err := os.ReadFile(memoryConfigPath(workspace))
	if err != nil || len(data) == 0 {
		return cfg
	}
	// Merge on top of defaults — missing keys keep their default values.
	_ = json.Unmarshal(data, &cfg)
	return cfg
}

// SaveMemoryConfig writes the tenant's memory.json atomically.
func SaveMemoryConfig(workspace string, cfg MemoryConfig) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	tmp := memoryConfigPath(workspace) + ".tmp"
	if err := os.WriteFile(tmp, data, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, memoryConfigPath(workspace))
}

// handleMemoryConfig serves GET/PUT for the tenant's memory.json.
func (s *Server) handleMemoryConfig(w http.ResponseWriter, r *http.Request, userID string) {
	u, err := s.store.GetUser(userID)
	if err != nil {
		respondErr(w, http.StatusNotFound, "user not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		cfg := LoadMemoryConfig(u.Workspace)
		respondJSON(w, http.StatusOK, cfg)

	case http.MethodPut:
		var cfg MemoryConfig
		if err := json.NewDecoder(r.Body).Decode(&cfg); err != nil {
			respondErr(w, http.StatusBadRequest, "invalid JSON: "+err.Error())
			return
		}
		if err := SaveMemoryConfig(u.Workspace, cfg); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Drop the in-memory agent instance so it re-reads memory.json on
		// the next message.
		if s.loop != nil {
			_ = s.loop.GetRegistry().RemoveUserAgent(userID)
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		respondErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}
