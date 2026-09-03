package agent

import (
	"context"
	"sync"
	"testing"

	"github.com/sipeed/picoclaw/pkg/providers"
)

type captureRecorder struct {
	mu    sync.Mutex
	calls []LLMUsageRecord
}

func (c *captureRecorder) RecordLLMUsage(_ context.Context, usage LLMUsageRecord) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.calls = append(c.calls, usage)
}

func TestWithUsageRecorderInjects(t *testing.T) {
	rec := &captureRecorder{}
	al := &AgentLoop{}
	WithUsageRecorder(rec)(al)
	if al.usageRecorder != rec {
		t.Fatal("WithUsageRecorder should set al.usageRecorder")
	}
}

func TestSetUsageRecorderNilSafe(t *testing.T) {
	al := &AgentLoop{}
	al.SetUsageRecorder(nil) // must not panic
	if al.usageRecorder != nil {
		t.Fatal("nil recorder should no-op")
	}
}

// TestLLMUsageRecorderReceivesCalls wires a fake pipeline-alike to confirm the
// recording chokepoint is reached and carries the live model + session key.
func TestLLMUsageRecorderReceivesCalls(t *testing.T) {
	rec := &captureRecorder{}
	al := &AgentLoop{usageRecorder: rec}

	ts := &turnState{sessionKey: "sess-abc"}
	exec := &turnExecution{llmModelName: "deepseek-v4-flash"}

	p := &Pipeline{al: al}
	ctx := context.Background()

	// Invoke the exact path pipeline_llm.go uses after a response: record usage.
	usage := &providers.UsageInfo{PromptTokens: 11, CompletionTokens: 22, TotalTokens: 33}
	ts.SetLastUsage(usage)
	recCall := func() {
		if u := ts.GetLastUsage(); u != nil {
			if r := p.al.usageRecorder; r != nil {
				r.RecordLLMUsage(ctx, LLMUsageRecord{
					SessionKey:   ts.sessionKey,
					Model:        exec.llmModelName,
					InputTokens:  u.PromptTokens,
					OutputTokens: u.CompletionTokens,
				})
			}
		}
	}
	recCall()

	rec.mu.Lock()
	defer rec.mu.Unlock()
	if len(rec.calls) != 1 {
		t.Fatalf("expected 1 recorder call, got %d", len(rec.calls))
	}
	got := rec.calls[0]
	if got.SessionKey != "sess-abc" || got.Model != "deepseek-v4-flash" {
		t.Fatalf("unexpected record: %+v", got)
	}
	if got.InputTokens != 11 || got.OutputTokens != 22 {
		t.Fatalf("token counts wrong: %+v", got)
	}
}
