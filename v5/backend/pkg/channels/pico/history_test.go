package pico

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/sipeed/picoclaw/pkg/agent"
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

func TestRecordLLMUsageAccumulatesPerModel(t *testing.T) {
	store := newTestHistoryStore(t)
	ctx := context.Background()

	// Same (session, model) accumulates; different model splits.
	store.RecordLLMUsage(ctx, agent.LLMUsageRecord{SessionKey: "s1", Model: "auto", InputTokens: 100, OutputTokens: 50})
	store.RecordLLMUsage(ctx, agent.LLMUsageRecord{SessionKey: "s1", Model: "auto", InputTokens: 200, OutputTokens: 80})
	store.RecordLLMUsage(ctx, agent.LLMUsageRecord{SessionKey: "s1", Model: "deepseek-v4-flash", InputTokens: 500, OutputTokens: 100})

	got, err := store.MonthUsage(ctx, time.Now())
	if err != nil {
		t.Fatalf("MonthUsage: %v", err)
	}
	if got.Requests != 3 {
		t.Fatalf("requests = %d, want 3", got.Requests)
	}
	if got.TotalTokens != 1030 {
		t.Fatalf("total = %d, want 1030", got.TotalTokens)
	}
	if got.InputTokens != 800 || got.OutputTokens != 230 {
		t.Fatalf("in/out = %d/%d, want 800/230", got.InputTokens, got.OutputTokens)
	}
	if len(got.ByModel) != 2 {
		t.Fatalf("by_model len = %d, want 2", len(got.ByModel))
	}
	byName := map[string]PicoUsageSummary{}
	for _, m := range got.ByModel {
		byName[m.Model] = m
	}
	auto := byName["auto"]
	if auto.Requests != 2 || auto.InputTokens != 300 || auto.OutputTokens != 130 {
		t.Fatalf("auto = %+v, want 2 req / 300 in / 130 out", auto)
	}
	if ds := byName["deepseek-v4-flash"]; ds.Requests != 1 || ds.TotalTokens != 600 {
		t.Fatalf("deepseek = %+v, want 1 req / 600 total", ds)
	}
}

func TestRecordLLMUsageZeroNoop(t *testing.T) {
	store := newTestHistoryStore(t)
	ctx := context.Background()

	store.RecordLLMUsage(ctx, agent.LLMUsageRecord{SessionKey: "s", Model: "m", InputTokens: 0, OutputTokens: 0})
	store.RecordLLMUsage(ctx, agent.LLMUsageRecord{}) // empty record must not panic

	got, err := store.MonthUsage(ctx, time.Now())
	if err != nil {
		t.Fatalf("MonthUsage: %v", err)
	}
	if got.Requests != 0 || got.TotalTokens != 0 {
		t.Fatalf("expected zero usage, got %+v", got)
	}
}

func TestRecordLLMUsageNilStoreSafe(t *testing.T) {
	var store *PicoHistoryStore
	store.RecordLLMUsage(context.Background(), agent.LLMUsageRecord{SessionKey: "s", InputTokens: 1, OutputTokens: 1})
}

func TestReplaceRecordLLMUsagePreservesAccumulation(t *testing.T) {
	// Regression guard: updating the same (session, model, task) row must ADD
	// not overwrite, so re-delivery / multi-iteration turns meter correctly.
	store := newTestHistoryStore(t)
	ctx := context.Background()
	store.RecordLLMUsage(ctx, agent.LLMUsageRecord{SessionKey: "s", Model: "m", InputTokens: 10, OutputTokens: 20})
	store.RecordLLMUsage(ctx, agent.LLMUsageRecord{SessionKey: "s", Model: "m", InputTokens: 30, OutputTokens: 40})

	got, err := store.MonthUsage(ctx, time.Now())
	if err != nil {
		t.Fatalf("MonthUsage: %v", err)
	}
	if got.InputTokens != 40 || got.OutputTokens != 60 {
		t.Fatalf("in/out = %d/%d, want 40/60 (accumulated)", got.InputTokens, got.OutputTokens)
	}
}