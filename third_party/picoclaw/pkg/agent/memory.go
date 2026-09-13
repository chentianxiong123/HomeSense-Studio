// PicoClaw - Ultra-lightweight personal AI agent
// Inspired by and based on nanobot: https://github.com/HKUDS/nanobot
// License: MIT
//
// Copyright (c) 2026 PicoClaw contributors

package agent

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/sipeed/picoclaw/pkg/fileutil"
)

// memoryFileConfig is the JSON shape stored in <workspace>/memory.json.
type memoryFileConfig struct {
	Memory struct {
		Enabled       bool `json:"enabled"`
		DailyNotes    struct {
			Enabled       bool `json:"enabled"`
			RetentionDays int  `json:"retention_days"`
		} `json:"daily_notes"`
		HistorySearch struct {
			Enabled    bool `json:"enabled"`
			MaxResults int  `json:"max_results"`
		} `json:"history_search"`
	} `json:"memory"`
}

// MemoryStore manages persistent memory for the agent.
// - Long-term memory: memory/MEMORY.md
// - Daily notes: memory/YYYYMM/YYYYMMDD.md
// - Profile: memory/MEMORY_PROFILE.md (auto-generated recent summary)
type MemoryStore struct {
	familyWorkspace string
	workspace          string
	memoryDir          string
	memoryFile         string
	profileFile        string
	profileTurnCount   int
	profileThreshold   int
	dailyRetentionDays int
	enabled            bool
	dailyNotesEnabled  bool
}

// NewMemoryStore creates a new MemoryStore with the given workspace path.
// It ensures the memory directory exists. Reads memory.json for config.
func NewMemoryStore(workspace string) *MemoryStore {
	return NewMemoryStoreWithOptions(workspace, 3)
}

// NewMemoryStoreWithOptions creates a MemoryStore with custom daily retention.
func NewMemoryStoreWithOptions(workspace string, dailyRetentionDays int) *MemoryStore {
	return NewMemoryStoreWithFamily(workspace, "", dailyRetentionDays)
}

func NewMemoryStoreWithFamily(workspace, familyWorkspace string, dailyRetentionDays int) *MemoryStore {
	if dailyRetentionDays <= 0 {
		dailyRetentionDays = 3
	}
	memoryDir := filepath.Join(workspace, "memory")
	memoryFile := filepath.Join(memoryDir, "MEMORY.md")
	profileFile := filepath.Join(memoryDir, "MEMORY_PROFILE.md")

	// Ensure memory directory exists
	os.MkdirAll(memoryDir, 0o755)

	ms := &MemoryStore{
		familyWorkspace:      familyWorkspace,
		workspace:          workspace,
		memoryDir:          memoryDir,
		memoryFile:         memoryFile,
		profileFile:        profileFile,
		profileTurnCount:   0,
		profileThreshold:   20, // default: generate profile every 20 turns
		dailyRetentionDays: dailyRetentionDays,
		enabled:            true,
		dailyNotesEnabled:  true,
	}

	// Try to read memory.json for overrides
	ms.loadConfig()
	// Load turn counter
	ms.loadProfileCounter()

	return ms
}

// loadConfig reads memory.json from the workspace root (if it exists)
// and overrides the default settings.
func (ms *MemoryStore) loadConfig() {
	cfgPath := filepath.Join(ms.workspace, "memory.json")
	data, err := os.ReadFile(cfgPath)
	if err != nil || len(data) == 0 {
		return
	}
	var fc memoryFileConfig
	if err := json.Unmarshal(data, &fc); err != nil {
		return
	}
	ms.enabled = fc.Memory.Enabled
	ms.dailyNotesEnabled = fc.Memory.DailyNotes.Enabled
	if fc.Memory.DailyNotes.RetentionDays > 0 {
		ms.dailyRetentionDays = fc.Memory.DailyNotes.RetentionDays
	}
}

// profileCounterFile stores the turn count for profile generation.
func (ms *MemoryStore) profileCounterFile() string {
	return filepath.Join(ms.memoryDir, ".profile_counter")
}

// loadProfileCounter reads the saved turn count.
func (ms *MemoryStore) loadProfileCounter() {
	data, err := os.ReadFile(ms.profileCounterFile())
	if err != nil {
		return
	}
	fmt.Sscanf(string(data), "%d", &ms.profileTurnCount)
}

// saveProfileCounter persists the turn count.
func (ms *MemoryStore) saveProfileCounter() {
	os.WriteFile(ms.profileCounterFile(), []byte(fmt.Sprintf("%d", ms.profileTurnCount)), 0o644)
}

// IncrementProfileTurnCount increments the counter and returns true if threshold reached.
func (ms *MemoryStore) IncrementProfileTurnCount() bool {
	ms.profileTurnCount++
	if ms.profileTurnCount >= ms.profileThreshold {
		ms.profileTurnCount = 0
		ms.saveProfileCounter()
		return true
	}
	ms.saveProfileCounter()
	return false
}

// GetProfileThreshold returns the configured threshold.
func (ms *MemoryStore) GetProfileThreshold() int {
	return ms.profileThreshold
}

// WriteProfile writes the MEMORY_PROFILE.md file (overwrites previous).
func (ms *MemoryStore) WriteProfile(content string) error {
	return os.WriteFile(ms.profileFile, []byte(content), 0o644)
}

// ReadProfile reads the MEMORY_PROFILE.md file.
func (ms *MemoryStore) ReadProfile() string {
	data, err := os.ReadFile(ms.profileFile)
	if err != nil {
		return ""
	}
	return string(data)
}

// getTodayFile returns the path to today's daily note file (memory/YYYYMM/YYYYMMDD.md).
func (ms *MemoryStore) getTodayFile() string {
	today := time.Now().Format("20060102") // YYYYMMDD
	monthDir := today[:6]                  // YYYYMM
	filePath := filepath.Join(ms.memoryDir, monthDir, today+".md")
	return filePath
}

// ReadLongTerm reads the long-term memory (MEMORY.md).
// Returns empty string if the file doesn't exist.
func (ms *MemoryStore) ReadLongTerm() string {
	if data, err := os.ReadFile(ms.memoryFile); err == nil {
		return string(data)
	}
	return ""
}

// WriteLongTerm writes content to the long-term memory file (MEMORY.md).
func (ms *MemoryStore) WriteLongTerm(content string) error {
	// Use unified atomic write utility with explicit sync for flash storage reliability.
	// Using 0o600 (owner read/write only) for secure default permissions.
	return fileutil.WriteFileAtomic(ms.memoryFile, []byte(content), 0o600)
}

// ReadToday reads today's daily note.
// Returns empty string if the file doesn't exist.
func (ms *MemoryStore) ReadToday() string {
	todayFile := ms.getTodayFile()
	if data, err := os.ReadFile(todayFile); err == nil {
		return string(data)
	}
	return ""
}

// AppendToday appends content to today's daily note.
// If the file doesn't exist, it creates a new file with a date header.
func (ms *MemoryStore) AppendToday(content string) error {
	todayFile := ms.getTodayFile()

	// Ensure month directory exists
	monthDir := filepath.Dir(todayFile)
	if err := os.MkdirAll(monthDir, 0o755); err != nil {
		return err
	}

	var existingContent string
	if data, err := os.ReadFile(todayFile); err == nil {
		existingContent = string(data)
	}

	var newContent string
	if existingContent == "" {
		// Add header for new day
		header := fmt.Sprintf("# %s\n\n", time.Now().Format("2006-01-02"))
		newContent = header + content
	} else {
		// Append to existing content
		newContent = existingContent + "\n" + content
	}

	// Use unified atomic write utility with explicit sync for flash storage reliability.
	return fileutil.WriteFileAtomic(todayFile, []byte(newContent), 0o600)
}

// GetRecentDailyNotes returns daily notes from the last N days.
// Contents are joined with "---" separator.
func (ms *MemoryStore) GetRecentDailyNotes(days int) string {
	var sb strings.Builder
	first := true

	for i := range days {
		date := time.Now().AddDate(0, 0, -i)
		dateStr := date.Format("20060102") // YYYYMMDD
		monthDir := dateStr[:6]            // YYYYMM
		filePath := filepath.Join(ms.memoryDir, monthDir, dateStr+".md")

		if data, err := os.ReadFile(filePath); err == nil {
			if !first {
				sb.WriteString("\n\n---\n\n")
			}
			sb.Write(data)
			first = false
		}
	}

	return sb.String()
}

// GetAllDailyNotes reads ALL daily notes from all months (permanent storage).
func (ms *MemoryStore) GetAllDailyNotes() string {
	var sb strings.Builder
	first := true

	entries, err := os.ReadDir(ms.memoryDir)
	if err != nil {
		return ""
	}

	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		monthDir := filepath.Join(ms.memoryDir, entry.Name())
		files, err := os.ReadDir(monthDir)
		if err != nil {
			continue
		}
		for _, f := range files {
			if f.IsDir() || !strings.HasSuffix(f.Name(), ".md") {
				continue
			}
			data, err := os.ReadFile(filepath.Join(monthDir, f.Name()))
			if err != nil {
				continue
			}
			if !first {
				sb.WriteString("\n\n---\n\n")
			}
			sb.Write(data)
			first = false
		}
	}

	return sb.String()
}

// GetMemoryContext returns formatted memory context for the agent prompt.
// Includes long-term memory and recent daily notes.
// Returns empty if memory is disabled via config.
func (ms *MemoryStore) GetMemoryContext() string {
	if !ms.enabled {
		return ""
	}

	// Family memory (shared across all family members)
	var familyMemory string
	if ms.familyWorkspace != "" {
		familyMemoryFile := filepath.Join(ms.familyWorkspace, "memory", "MEMORY.md")
		if data, err := os.ReadFile(familyMemoryFile); err == nil {
			familyMemory = string(data)
		}
	}

	longTerm := ms.ReadLongTerm()

	var recentNotes string
	if ms.dailyNotesEnabled {
		recentNotes = ms.GetAllDailyNotes()
	}

	if longTerm == "" && recentNotes == "" && familyMemory == "" {
		return ""
	}

	var sb strings.Builder

	if familyMemory != "" {
		sb.WriteString("## Family Memory\n\n")
		sb.WriteString(familyMemory)
	}

	if longTerm != "" {
		if familyMemory != "" {
			sb.WriteString("\n\n---\n\n")
		}
		sb.WriteString("## Long-term Memory\n\n")
		sb.WriteString(longTerm)
	}

	if recentNotes != "" {
		if longTerm != "" || familyMemory != "" {
			sb.WriteString("\n\n---\n\n")
		}
		sb.WriteString("## Recent Daily Notes\n\n")
		sb.WriteString(recentNotes)
	}

	return sb.String()
}
