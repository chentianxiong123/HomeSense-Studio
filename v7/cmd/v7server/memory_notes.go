package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// DailyNote represents a single daily note file.
type DailyNote struct {
	Date    string `json:"date"`    // YYYY-MM-DD
	Content string `json:"content"` // file content
	Size    int64  `json:"size"`    // file size in bytes
	ModTime string `json:"mod_time"`
}

// handleMemoryNotes serves GET for listing/reading daily notes.
// GET /api/v1/users/{id}/memory/notes          -> list all notes
// GET /api/v1/users/{id}/memory/notes?date=...  -> read specific note
func (s *Server) handleMemoryNotes(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodGet {
		respondErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	u, err := s.store.GetUser(userID)
	if err != nil {
		respondErr(w, http.StatusNotFound, "user not found")
		return
	}

	memoryDir := filepath.Join(u.Workspace, "memory")
	date := r.URL.Query().Get("date")

	if date != "" {
		// Read specific note.
		note, err := readDailyNote(memoryDir, date)
		if err != nil {
			respondErr(w, http.StatusNotFound, fmt.Sprintf("note not found: %s", date))
			return
		}
		respondJSON(w, http.StatusOK, note)
		return
	}

	// List all notes.
	notes, err := listDailyNotes(memoryDir)
	if err != nil {
		respondErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"notes": notes,
		"total": len(notes),
	})
}

// handleMemoryFiles serves GET for reading any memory file (MEMORY.md, etc.).
// GET /api/v1/users/{id}/memory/files?path=MEMORY.md
func (s *Server) handleMemoryFiles(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodGet {
		respondErr(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	u, err := s.store.GetUser(userID)
	if err != nil {
		respondErr(w, http.StatusNotFound, "user not found")
		return
	}

	relPath := r.URL.Query().Get("path")
	if relPath == "" {
		respondErr(w, http.StatusBadRequest, "path is required")
		return
	}

	// Security: prevent path traversal.
	if strings.Contains(relPath, "..") || strings.HasPrefix(relPath, "/") {
		respondErr(w, http.StatusBadRequest, "invalid path")
		return
	}

	absPath := filepath.Join(u.Workspace, "memory", relPath)
	data, err := os.ReadFile(absPath)
	if err != nil {
		respondErr(w, http.StatusNotFound, "file not found")
		return
	}

	info, _ := os.Stat(absPath)
	respondJSON(w, http.StatusOK, map[string]any{
		"path":     relPath,
		"content":  string(data),
		"size":     info.Size(),
		"mod_time": info.ModTime().Format(time.RFC3339),
	})
}

// handleAgentFile serves GET/PUT for workspace root files (AGENT.md, SOUL.md, etc.).
// GET  /api/v1/users/{id}/agent-file?path=AGENT.md
// PUT  /api/v1/users/{id}/agent-file  body: { "path": "AGENT.md", "content": "..." }
func (s *Server) handleAgentFile(w http.ResponseWriter, r *http.Request, userID string) {
	u, err := s.store.GetUser(userID)
	if err != nil {
		respondErr(w, http.StatusNotFound, "user not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		relPath := r.URL.Query().Get("path")
		if relPath == "" {
			respondErr(w, http.StatusBadRequest, "path is required")
			return
		}
		if strings.Contains(relPath, "..") || strings.HasPrefix(relPath, "/") {
			respondErr(w, http.StatusBadRequest, "invalid path")
			return
		}
		absPath := filepath.Join(u.Workspace, relPath)
		data, err := os.ReadFile(absPath)
		if err != nil {
			// Return empty content for new files.
			respondJSON(w, http.StatusOK, map[string]any{
				"path":    relPath,
				"content": "",
				"exists":  false,
			})
			return
		}
		info, _ := os.Stat(absPath)
		respondJSON(w, http.StatusOK, map[string]any{
			"path":     relPath,
			"content":  string(data),
			"size":     info.Size(),
			"mod_time": info.ModTime().Format(time.RFC3339),
			"exists":   true,
		})

	case http.MethodPut:
		var req struct {
			Path    string `json:"path"`
			Content string `json:"content"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			respondErr(w, http.StatusBadRequest, "invalid JSON")
			return
		}
		if req.Path == "" {
			respondErr(w, http.StatusBadRequest, "path is required")
			return
		}
		if strings.Contains(req.Path, "..") || strings.HasPrefix(req.Path, "/") {
			respondErr(w, http.StatusBadRequest, "invalid path")
			return
		}
		absPath := filepath.Join(u.Workspace, req.Path)
		if err := os.MkdirAll(filepath.Dir(absPath), 0o755); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := os.WriteFile(absPath, []byte(req.Content), 0o644); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		respondErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// listDailyNotes scans memory/YYYYMM/ directories for daily note files.
func listDailyNotes(memoryDir string) ([]DailyNote, error) {
	var notes []DailyNote

	// Walk YYYYMM directories.
	entries, err := os.ReadDir(memoryDir)
	if err != nil {
		if os.IsNotExist(err) {
			return notes, nil
		}
		return nil, err
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		monthDir := filepath.Join(memoryDir, entry.Name())
		files, err := os.ReadDir(monthDir)
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() {
				continue
			}
			name := f.Name()
			// Expect format: YYYY-MM-DD.md or YYYYMMDD.md
			date := parseNoteDate(entry.Name(), name)
			if date == "" {
				continue
			}
			info, err := f.Info()
			if err != nil {
				continue
			}
			data, err := os.ReadFile(filepath.Join(monthDir, name))
			if err != nil {
				continue
			}
			notes = append(notes, DailyNote{
				Date:    date,
				Content: string(data),
				Size:    info.Size(),
				ModTime: info.ModTime().Format(time.RFC3339),
			})
		}
	}

	// Sort by date descending (newest first).
	sort.Slice(notes, func(i, j int) bool {
		return notes[i].Date > notes[j].Date
	})

	return notes, nil
}

// readDailyNote reads a specific daily note by date (YYYY-MM-DD).
func readDailyNote(memoryDir, date string) (*DailyNote, error) {
	// Try YYYYMM/DD.md pattern.
	month := date[:7] // YYYY-MM
	day := date[8:10]
	paths := []string{
		filepath.Join(memoryDir, month, day+".md"),
		filepath.Join(memoryDir, month, date+".md"),
		filepath.Join(memoryDir, month, date),
	}

	for _, p := range paths {
		data, err := os.ReadFile(p)
		if err == nil {
			info, _ := os.Stat(p)
			return &DailyNote{
				Date:    date,
				Content: string(data),
				Size:    info.Size(),
				ModTime: info.ModTime().Format(time.RFC3339),
			}, nil
		}
	}
	return nil, fmt.Errorf("note not found for %s", date)
}

// parseNoteDate extracts YYYY-MM-DD from directory name + filename.
func parseNoteDate(dirName, fileName string) string {
	// dir: YYYYMM, file: DD.md -> YYYY-MM-DD
	if len(dirName) == 6 {
		year := dirName[:4]
		month := dirName[4:6]
		name := strings.TrimSuffix(fileName, ".md")
		if len(name) == 2 {
			return fmt.Sprintf("%s-%s-%s", year, month, name)
		}
		// Try YYYY-MM-DD.md
		if len(name) == 10 && name[4] == '-' && name[7] == '-' {
			return name
		}
	}
	return ""
}
