package agent

import (
	"context"

	runtimeevents "github.com/sipeed/picoclaw/pkg/events"
)

// AgentLoopOption configures an AgentLoop at construction time.
type AgentLoopOption func(*AgentLoop)

// LLMUsageRecord is one real per-LLM-call measurement handed to the
// UsageRecorder. It always carries the model active *at the time of that call*
// (so mid-session model switches meter correctly), the session key, and the
// actual input/output token counts from the provider response.
type LLMUsageRecord struct {
	SessionKey   string
	Model        string
	InputTokens  int
	OutputTokens int
}

// UsageRecorder receives every LLM call's token usage. It is the single
// metering chokepoint (mirrors hermes' update_token_counts): the agent only
// measures, never bills. The channel (e.g. pico) implements it to persist into
// the tenant DB. Implementations must never fail the turn (best-effort).
type UsageRecorder interface {
	RecordLLMUsage(ctx context.Context, usage LLMUsageRecord)
}

// WithUsageRecorder injects the metering sink. Nil-safe: when nil, no metering
// is performed (the loop runs exactly as before).
func WithUsageRecorder(rec UsageRecorder) AgentLoopOption {
	return func(al *AgentLoop) {
		al.usageRecorder = rec
	}
}

// WithRuntimeEvents injects the runtime event bus used for new observation APIs.
//
// The injected bus is treated as externally owned and will not be closed by
// AgentLoop.Close. Passing nil leaves the default owned runtime bus enabled.
func WithRuntimeEvents(bus runtimeevents.Bus) AgentLoopOption {
	return func(al *AgentLoop) {
		if bus == nil {
			return
		}
		al.runtimeEvents = bus
		al.ownsRuntimeEvents = false
	}
}
