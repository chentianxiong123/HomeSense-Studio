package memory

import (
	"context"
	"encoding/json"
	"sync"
	"testing"

	"github.com/sipeed/picoclaw/pkg/providers"
)

func newTestSQLiteStore(t *testing.T) *SQLiteStore {
	t.Helper()
	store, err := NewSQLiteStore(t.TempDir())
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestSQLite_BasicRoundtrip(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	if err := store.AddMessage(ctx, "s1", "user", "hello"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}
	if err := store.AddMessage(ctx, "s1", "assistant", "hi there"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}

	history, err := store.GetHistory(ctx, "s1")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(history))
	}
	if history[0].Role != "user" || history[0].Content != "hello" {
		t.Errorf("msg[0] = %+v", history[0])
	}
	if history[1].Role != "assistant" || history[1].Content != "hi there" {
		t.Errorf("msg[1] = %+v", history[1])
	}
}

func TestSQLite_AddMessage_AutoCreatesSession(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	if err := store.AddMessage(ctx, "new-session", "user", "first message"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}
	history, err := store.GetHistory(ctx, "new-session")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("expected 1 message, got %d", len(history))
	}
}

func TestSQLite_FullMessage_WithToolCalls(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	msg := providers.Message{
		Role:    "assistant",
		Content: "Let me search that.",
		ToolCalls: []providers.ToolCall{
			{
				ID:   "call_abc",
				Type: "function",
				Function: &providers.FunctionCall{
					Name:      "web_search",
					Arguments: `{"q":"golang sqlite"}`,
				},
			},
		},
	}
	if err := store.AddFullMessage(ctx, "tc", msg); err != nil {
		t.Fatalf("AddFullMessage: %v", err)
	}

	history, err := store.GetHistory(ctx, "tc")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("expected 1, got %d", len(history))
	}
	if len(history[0].ToolCalls) != 1 {
		t.Fatalf("expected 1 tool call, got %d", len(history[0].ToolCalls))
	}
	tc := history[0].ToolCalls[0]
	if tc.ID != "call_abc" {
		t.Errorf("tool call ID = %q", tc.ID)
	}
	if tc.Function == nil || tc.Function.Name != "web_search" {
		t.Errorf("tool call function = %+v", tc.Function)
	}
}

func TestSQLite_FullMessage_PreservesModelNameAndReasoning(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	if err := store.AddFullMessage(ctx, "m", providers.Message{
		Role:             "assistant",
		Content:          "answer",
		ModelName:        "auto",
		ReasoningContent: "reasoning",
	}); err != nil {
		t.Fatalf("AddFullMessage: %v", err)
	}
	history, err := store.GetHistory(ctx, "m")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if history[0].ModelName != "auto" {
		t.Errorf("model = %q", history[0].ModelName)
	}
	if history[0].ReasoningContent != "reasoning" {
		t.Errorf("reasoning = %q", history[0].ReasoningContent)
	}
}

func TestSQLite_DropsTransientAssistantThought(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	if err := store.AddFullMessage(ctx, "t", providers.Message{
		Role:             "assistant",
		ReasoningContent: "internal chain of thought",
	}); err != nil {
		t.Fatalf("AddFullMessage: %v", err)
	}
	history, err := store.GetHistory(ctx, "t")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 0 {
		t.Fatalf("expected transient thought discarded, got %d", len(history))
	}
}

func TestSQLite_GetHistory_EmptySession(t *testing.T) {
	store := newTestSQLiteStore(t)
	history, err := store.GetHistory(context.Background(), "nonexistent")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if history == nil {
		t.Fatal("expected empty slice, got nil")
	}
	if len(history) != 0 {
		t.Fatalf("expected 0 messages, got %d", len(history))
	}
}

func TestSQLite_SummaryRoundtrip(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	if got := mustGetSummary(t, store, ctx, "s"); got != "" {
		t.Fatalf("initial summary = %q, want empty", got)
	}
	if err := store.SetSummary(ctx, "s", "the conversation summary"); err != nil {
		t.Fatalf("SetSummary: %v", err)
	}
	if got := mustGetSummary(t, store, ctx, "s"); got != "the conversation summary" {
		t.Fatalf("summary = %q", got)
	}
}

func TestSQLite_TruncateHistory_KeepLast(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	for i := 0; i < 5; i++ {
		if err := store.AddMessage(ctx, "s", "user", string(rune('a'+i))); err != nil {
			t.Fatalf("AddMessage %d: %v", i, err)
		}
	}
	if err := store.TruncateHistory(ctx, "s", 2); err != nil {
		t.Fatalf("TruncateHistory: %v", err)
	}
	history, err := store.GetHistory(ctx, "s")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("expected 2 messages, got %d", len(history))
	}
	if history[0].Content != "d" || history[1].Content != "e" {
		t.Errorf("history = %+v", history)
	}
}

func TestSQLite_TruncateHistory_KeepZeroAndMore(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	for i := 0; i < 3; i++ {
		if err := store.AddMessage(ctx, "s", "user", "m"); err != nil {
			t.Fatalf("AddMessage: %v", err)
		}
	}
	if err := store.TruncateHistory(ctx, "s", 0); err != nil {
		t.Fatalf("TruncateHistory(0): %v", err)
	}
	if h, _ := store.GetHistory(ctx, "s"); len(h) != 0 {
		t.Fatalf("expected 0 after keepZero, got %d", len(h))
	}

	for i := 0; i < 3; i++ {
		if err := store.AddMessage(ctx, "s", "user", "n"); err != nil {
			t.Fatalf("AddMessage: %v", err)
		}
	}
	if err := store.TruncateHistory(ctx, "s", 100); err != nil {
		t.Fatalf("TruncateHistory(100): %v", err)
	}
	if h, _ := store.GetHistory(ctx, "s"); len(h) != 3 {
		t.Fatalf("expected all 3 after keepMore, got %d", len(h))
	}
}

func TestSQLite_SetHistory_ReplacesAndResetsSkip(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	for i := 0; i < 4; i++ {
		if err := store.AddMessage(ctx, "s", "user", "old"); err != nil {
			t.Fatalf("AddMessage: %v", err)
		}
	}
	if err := store.TruncateHistory(ctx, "s", 1); err != nil {
		t.Fatalf("TruncateHistory: %v", err)
	}
	if h, _ := store.GetHistory(ctx, "s"); len(h) != 1 {
		t.Fatalf("expected 1 after truncate, got %d", len(h))
	}

	now := "fresh"
	if err := store.SetHistory(ctx, "s", []providers.Message{
		{Role: "user", Content: now},
		{Role: "assistant", Content: "reply"},
	}); err != nil {
		t.Fatalf("SetHistory: %v", err)
	}
	history, err := store.GetHistory(ctx, "s")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 2 || history[0].Content != now {
		t.Fatalf("history after SetHistory = %+v", history)
	}
}

func TestSQLite_Compact_RemovesSkipped(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	for i := 0; i < 4; i++ {
		if err := store.AddMessage(ctx, "s", "user", "x"); err != nil {
			t.Fatalf("AddMessage: %v", err)
		}
	}
	if err := store.TruncateHistory(ctx, "s", 1); err != nil {
		t.Fatalf("TruncateHistory: %v", err)
	}
	if err := store.Compact(ctx, "s"); err != nil {
		t.Fatalf("Compact: %v", err)
	}
	// After compaction, skipping is reset and appends still work.
	if err := store.AddMessage(ctx, "s", "user", "after"); err != nil {
		t.Fatalf("AddMessage after compact: %v", err)
	}
	history, err := store.GetHistory(ctx, "s")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 2 {
		t.Fatalf("expected 2 (kept + appended), got %d", len(history))
	}
	if history[1].Content != "after" {
		t.Errorf("last message = %+v", history[1])
	}
}

func TestSQLite_MetaScopeAndAliases(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	scope := json.RawMessage(`{"channel":"pico","chat":"c1"}`)
	if err := store.UpsertSessionMeta(ctx, "canonical", scope, []string{"alias-1", "alias-2", "canonical", ""}); err != nil {
		t.Fatalf("UpsertSessionMeta: %v", err)
	}

	resolved, found, err := store.ResolveSessionKey(ctx, "alias-1")
	if err != nil {
		t.Fatalf("ResolveSessionKey: %v", err)
	}
	if !found || resolved != "canonical" {
		t.Fatalf("alias-1 -> %q (found=%v)", resolved, found)
	}

	meta, err := store.GetSessionMeta(ctx, "canonical")
	if err != nil {
		t.Fatalf("GetSessionMeta: %v", err)
	}
	if string(meta.Scope) != string(scope) {
		t.Errorf("scope = %s", meta.Scope)
	}
	if len(meta.Aliases) != 2 || meta.Aliases[0] != "alias-1" || meta.Aliases[1] != "alias-2" {
		t.Errorf("aliases = %v", meta.Aliases)
	}
}

func TestSQLite_PromoteAliasHistory(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	// Seed history under an alias session key.
	if err := store.AddMessage(ctx, "web:pre", "user", "legacy question"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}
	if err := store.AddMessage(ctx, "web:pre", "assistant", "legacy answer"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}

	aliases := []string{"web:pre"}
	promoted, err := store.PromoteAliasHistory(ctx, "web:main", nil, aliases)
	if err != nil {
		t.Fatalf("PromoteAliasHistory: %v", err)
	}
	if !promoted {
		t.Fatal("expected promotion to occur")
	}

	history, err := store.GetHistory(ctx, "web:main")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 2 || history[0].Content != "legacy question" {
		t.Fatalf("promoted history = %+v", history)
	}

	// Canonical already has content: no second promotion.
	if err := store.AddMessage(ctx, "web:main", "user", "new question"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}
	again, err := store.PromoteAliasHistory(ctx, "web:main", nil, aliases)
	if err != nil {
		t.Fatalf("PromoteAliasHistory: %v", err)
	}
	if again {
		t.Fatal("expected no promotion when canonical already has content")
	}
}

func TestSQLite_MultipleSessions_Isolation(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()

	if err := store.AddMessage(ctx, "a", "user", "alpha"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}
	if err := store.AddMessage(ctx, "b", "user", "beta"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}

	ha, _ := store.GetHistory(ctx, "a")
	hb, _ := store.GetHistory(ctx, "b")
	if len(ha) != 1 || ha[0].Content != "alpha" {
		t.Errorf("a = %+v", ha)
	}
	if len(hb) != 1 || hb[0].Content != "beta" {
		t.Errorf("b = %+v", hb)
	}

	keys := store.ListSessions()
	if len(keys) != 2 {
		t.Fatalf("expected 2 sessions, got %v", keys)
	}
}

func TestSQLite_Persistence_AcrossInstances(t *testing.T) {
	dir := t.TempDir()
	ctx := context.Background()

	store, err := NewSQLiteStore(dir)
	if err != nil {
		t.Fatalf("NewSQLiteStore: %v", err)
	}
	if err := store.AddMessage(ctx, "persist", "user", "survives restart"); err != nil {
		t.Fatalf("AddMessage: %v", err)
	}
	if err := store.Close(); err != nil {
		t.Fatalf("Close: %v", err)
	}

	store2, err := NewSQLiteStore(dir)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer store2.Close()
	history, err := store2.GetHistory(ctx, "persist")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != 1 || history[0].Content != "survives restart" {
		t.Fatalf("history = %+v", history)
	}
}

func TestSQLite_Concurrent_AddAndRead(t *testing.T) {
	store := newTestSQLiteStore(t)
	ctx := context.Background()
	const goroutines = 8
	const perG = 25

	var wg sync.WaitGroup
	errs := make(chan error, goroutines)
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func(g int) {
			defer wg.Done()
			for i := 0; i < perG; i++ {
				if err := store.AddMessage(ctx, "shared", "user", "m"); err != nil {
					errs <- err
					return
				}
			}
			if _, err := store.GetHistory(ctx, "shared"); err != nil {
				errs <- err
			}
		}(g)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Fatalf("concurrent op: %v", err)
	}

	history, err := store.GetHistory(ctx, "shared")
	if err != nil {
		t.Fatalf("GetHistory: %v", err)
	}
	if len(history) != goroutines*perG {
		t.Fatalf("expected %d messages, got %d", goroutines*perG, len(history))
	}
}

func mustGetSummary(t *testing.T, store Store, ctx context.Context, key string) string {
	t.Helper()
	summary, err := store.GetSummary(ctx, key)
	if err != nil {
		t.Fatalf("GetSummary: %v", err)
	}
	return summary
}
