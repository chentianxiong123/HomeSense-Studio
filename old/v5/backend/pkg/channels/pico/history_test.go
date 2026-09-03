package pico

import (
	"path/filepath"
	"testing"
)

func newTestHistoryStore(t *testing.T) *PicoHistoryStore {
	t.Helper()
	dir := t.TempDir()
	store, err := NewPicoHistoryStore(filepath.Join(dir, "test.db"))
	if err != nil {
		t.Fatalf("NewPicoHistoryStore: %v", err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}