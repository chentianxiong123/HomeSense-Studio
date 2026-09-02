package agent

import (
	"encoding/json"
	"testing"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/providers"
)

func TestAttachMeterUsageToOutbound(t *testing.T) {
	mkMsg := func() bus.OutboundMessage {
		ctx := bus.NewOutboundContext("pico", "pico:sess-1", "")
		return bus.OutboundMessage{Context: ctx, Content: "answer"}
	}

	t.Run("attaches usage JSON when usage present", func(t *testing.T) {
		msg := attachMeterUsageToOutbound(mkMsg(), &providers.UsageInfo{
			PromptTokens: 100, CompletionTokens: 50, TotalTokens: 150,
		})
		raw, ok := msg.Context.Raw["meter_usage"]
		if !ok || raw == "" {
			t.Fatalf("expected meter_usage in raw, got %+v", msg.Context.Raw)
		}
		var got map[string]int
		if err := json.Unmarshal([]byte(raw), &got); err != nil {
			t.Fatalf("meter_usage not valid JSON: %v", err)
		}
		if got["input_tokens"] != 100 || got["output_tokens"] != 50 || got["total_tokens"] != 150 {
			t.Fatalf("meter_usage = %v", got)
		}
	})

	t.Run("keeps msg untouched when usage nil", func(t *testing.T) {
		msg := mkMsg()
		msg.Context.Raw = map[string]string{"model_name": "auto"}
		out := attachMeterUsageToOutbound(msg, nil)
		if _, ok := out.Context.Raw["meter_usage"]; ok {
			t.Fatal("should not add meter_usage when usage is nil")
		}
		if out.Context.Raw["model_name"] != "auto" {
			t.Fatal("should preserve existing raw keys")
		}
	})
}

func TestAgentOutboundCarriesMeterUsage(t *testing.T) {
	// Guards against regressions in the wire key shared by agent (writer) and
	// pico channel (reader).
	msg := attachMeterUsageToOutbound(
		bus.OutboundMessage{Context: bus.NewOutboundContext("pico", "c", "")},
		&providers.UsageInfo{PromptTokens: 5, CompletionTokens: 7, TotalTokens: 12},
	)
	if _, ok := msg.Context.Raw["meter_usage"]; !ok {
		t.Fatal("agent outbound must carry meter_usage for pico to meter")
	}
}