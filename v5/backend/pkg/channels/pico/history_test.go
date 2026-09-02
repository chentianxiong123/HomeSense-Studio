package pico

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	_ "modernc.org/sqlite"
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

func TestRecordUsageAndMonthUsage(t *testing.T) {
	store := newTestHistoryStore(t)
	ctx := context.Background()

	// Record a few rows across two models.
	must := func(err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("unexpected err: %v", err)
		}
	}
	must(store.RecordUsage(ctx, "s1", "auto", 100, 50))
	must(store.RecordUsage(ctx, "s1", "auto", 200, 80))
	must(store.RecordUsage(ctx, "s2", "deepseek-v4-flash", 500, 100))
	must(store.RecordUsage(ctx, "s3", "", 0, 0)) // no-op

	t.Run("zero-usage no-op inserts nothing", func(t *testing.T) {
		got, err := store.MonthUsage(ctx, time.Now())
		if err != nil {
			t.Fatalf("MonthUsage: %v", err)
		}
		if got.Requests != 3 {
			t.Fatalf("requests = %d, want 3", got.Requests)
		}
	})

	got, err := store.MonthUsage(ctx, time.Now())
	if err != nil {
		t.Fatalf("MonthUsage: %v", err)
	}
	if got.TotalTokens != 1030 {
		t.Errorf("total_tokens = %d, want 1030 (100+50+200+80 + 500+100)", got.TotalTokens)
	}
	if got.InputTokens != 800 {
		t.Errorf("input_tokens = %d, want 800", got.InputTokens)
	}
	if got.OutputTokens != 230 {
		t.Errorf("output_tokens = %d, want 230", got.OutputTokens)
	}
	if len(got.ByModel) != 2 {
		t.Fatalf("by_model len = %d, want 2", len(got.ByModel))
	}
	byName := map[string]PicoUsageSummary{}
	for _, m := range got.ByModel {
		byName[m.Model] = m
	}
	auto := byName["auto"]
	if auto.Requests != 2 || auto.TotalTokens != 430 {
		t.Errorf("auto summary = %+v, want 2 reqs / 430 tokens", auto)
	}
	ds := byName["deepseek-v4-flash"]
	if ds.Requests != 1 || ds.TotalTokens != 600 {
		t.Errorf("deepseek summary = %+v, want 1 req / 600 tokens", ds)
	}
}

func TestMonthUsageSkipsOlderRows(t *testing.T) {
	store := newTestHistoryStore(t)
	ctx := context.Background()

	// Insert two rows with explicit old timestamps (previous month) using raw
	// SQL so MonthUsage's month-boundary filter is exercised.
	store.mu.Lock()
	_, err := store.db.ExecContext(ctx,
		`INSERT INTO pico_usage (session_id, model, input_tokens, output_tokens, total_tokens, created_at)
		 VALUES ('old', 'auto', 999, 1, 1000, '2020-01-15T10:00:00Z')`)
	store.mu.Unlock()
	if err != nil {
		t.Fatalf("seed old row: %v", err)
	}

	now := time.Date(2020, 2, 10, 0, 0, 0, 0, time.UTC)
	got, err := store.MonthUsage(ctx, now)
	if err != nil {
		t.Fatalf("MonthUsage: %v", err)
	}
	if got.Requests != 0 || got.TotalTokens != 0 {
		t.Fatalf("expected old row excluded, got %+v", got)
	}
}

func TestRecordUsageNothingWhenStoreNil(t *testing.T) {
	var s *PicoHistoryStore
	if err := s.RecordUsage(context.Background(), "s", "m", 1, 2); err != nil {
		t.Fatalf("nil store should be a no-op, got: %v", err)
	}
}