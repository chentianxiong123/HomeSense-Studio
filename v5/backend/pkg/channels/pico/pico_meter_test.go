package pico

import (
	"context"
	"testing"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
)

func TestRecordUsageFromOutbound(t *testing.T) {
	store := newTestHistoryStore(t)
	ch := &PicoChannel{history: store}

	mkMsg := func(raw map[string]string) bus.OutboundMessage {
		ctx := bus.NewOutboundContext("pico", "chat", "")
		ctx.Raw = raw
		return bus.OutboundMessage{
			Context: ctx,
			Content: "answer",
		}
	}

	t.Run("records usage from meter_usage", func(t *testing.T) {
		ch.recordUsageFromOutbound(
			mkMsg(map[string]string{
				"model_name":  "auto",
				"meter_usage": `{"input_tokens":100,"output_tokens":50,"total_tokens":150}`,
			}),
			"sess-1", "auto",
		)
		got, err := store.MonthUsage(context.Background(), time.Now())
		if err != nil {
			t.Fatalf("MonthUsage: %v", err)
		}
		if got.Requests != 1 || got.InputTokens != 100 || got.OutputTokens != 50 {
			t.Fatalf("usage = %+v, want 1 req / 100 in / 50 out", got)
		}
	})

	t.Run("no-op when meter_usage absent", func(t *testing.T) {
		ch.recordUsageFromOutbound(mkMsg(map[string]string{"model_name": "auto"}), "sess-1", "auto")
		got, _ := store.MonthUsage(context.Background(), time.Now())
		if got.Requests != 1 {
			t.Fatalf("requests = %d, want still 1", got.Requests)
		}
	})

	t.Run("no-op on malformed JSON", func(t *testing.T) {
		ch.recordUsageFromOutbound(
			mkMsg(map[string]string{"meter_usage": "not-json"}),
			"sess-1", "auto",
		)
		got, _ := store.MonthUsage(context.Background(), time.Now())
		if got.Requests != 1 {
			t.Fatalf("requests = %d, want still 1", got.Requests)
		}
	})

	t.Run("nil history is safe", func(t *testing.T) {
		(&PicoChannel{}).recordUsageFromOutbound(
			mkMsg(map[string]string{"meter_usage": `{}`}),
			"sess-1", "auto",
		)
	})
}