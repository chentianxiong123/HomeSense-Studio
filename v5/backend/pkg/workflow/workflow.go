// Package workflow integrates HomeSense executor tools as RuleGo nodes.
//
// Each HomeSense tool (adb_cmd, mi_device, bilibili_ctl, ...) is wrapped as a
// RuleGo Node. The brain emits a JSON DSL describing a rule chain; the
// executor loads it into RuleGo, dispatches a message, and walks the graph.
//
// Why RuleGo: pure Go, embedded, JSON DSL, hot-reload, ~1.6k stars, designed
// for IoT edge. See v5/docs/rulego-workflow-integration.md.
package workflow

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/rulego/rulego"
	"github.com/rulego/rulego/api/types"
)

// CapabilityCaller is the contract each wrapped tool satisfies. It receives
// the action name and a parameter map and returns either a result map or
// an error. The shape mirrors the MCP tool handlers so the same code path
// can serve both interfaces.
type CapabilityCaller interface {
	// Name returns the tool name exposed to the brain (e.g. "mi_device").
	Name() string
	// Call invokes the underlying capability with the given arguments.
	// arguments is the JSON-decoded parameter map from the RuleGo node.
	// Returns the same map shape the MCP handler would return.
	Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error)
}

// Registry holds the set of capabilities available as RuleGo nodes and the
// running rule engines indexed by chain ID. It is safe for concurrent use.
type Registry struct {
	mu      sync.RWMutex
	tools   map[string]CapabilityCaller
	engines map[string]types.RuleEngine
	onDebug func(chainID, nodeID, msgType, relation string, err error)
}

// NewRegistry creates an empty registry. Call Register for each tool the
// executor exposes, then use Load() to compile rule chains.
func NewRegistry() *Registry {
	return &Registry{
		tools:   make(map[string]CapabilityCaller),
		engines: make(map[string]types.RuleEngine),
	}
}

// SetDebugCallback hooks into RuleGo's per-node trace. nil disables it.
// The callback fires on node enter/exit so the brain can stream a timeline.
func (r *Registry) SetDebugCallback(cb func(chainID, nodeID, msgType, relation string, err error)) {
	r.mu.Lock()
	r.onDebug = cb
	r.mu.Unlock()
}

// Register adds a capability caller and wires its RuleGo node factory.
// Idempotent on the same Name(); later calls overwrite the registration.
func (r *Registry) Register(c CapabilityCaller) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tools[c.Name()] = c
	rulego.Registry.Register(&capabilityNode{caller: c})
}

// Names returns the registered tool names in unspecified order. Used to
// surface the workflow's available toolset back to the brain.
func (r *Registry) Names() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.tools))
	for n := range r.tools {
		out = append(out, n)
	}
	return out
}

// Engine is an alias for a running rule chain instance. The brain receives
// a handle (the chain ID) and can later query or stop it via this type.
type Engine struct {
	chainID string
	ruleEng types.RuleEngine
}

// Load parses the rule chain DSL and creates a running engine. The chain ID
// inside the JSON takes precedence; if empty, fallbackID is used.
//
// Load replaces any existing engine with the same ID.
func (r *Registry) Load(fallbackID string, dsl []byte) (*Engine, error) {
	var parsed struct {
		RuleChain struct {
			ID string `json:"id"`
		} `json:"ruleChain"`
	}
	if err := json.Unmarshal(dsl, &parsed); err != nil {
		return nil, fmt.Errorf("workflow: parse dsl: %w", err)
	}
	chainID := parsed.RuleChain.ID
	if chainID == "" {
		chainID = fallbackID
	}
	if chainID == "" {
		return nil, fmt.Errorf("workflow: missing ruleChain.id")
	}

	// Drop any prior engine with the same ID; rulego.New fails on duplicate.
	r.mu.Lock()
	if old, ok := r.engines[chainID]; ok {
		old.Stop(context.Background())
		delete(r.engines, chainID)
	}
	r.mu.Unlock()

	cfg := rulego.NewConfig()
	r.mu.RLock()
	if r.onDebug != nil {
		// rulego retains a reference, so copy the current callback.
		cb := r.onDebug
		cfg.OnDebug = func(chainId, flowType, nodeId string, msg types.RuleMsg, relationType string, err error) {
			cb(chainId, nodeId, msg.Type, relationType, err)
		}
	}
	r.mu.RUnlock()

	re, err := rulego.New(chainID, dsl, rulego.WithConfig(cfg))
	if err != nil {
		return nil, fmt.Errorf("workflow: load chain %q: %w", chainID, err)
	}

	r.mu.Lock()
	r.engines[chainID] = re
	r.mu.Unlock()
	return &Engine{chainID: chainID, ruleEng: re}, nil
}

// Get returns a running engine by ID, if any.
func (r *Registry) Get(chainID string) (*Engine, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	re, ok := r.engines[chainID]
	if !ok {
		return nil, false
	}
	return &Engine{chainID: chainID, ruleEng: re}, true
}

// StopAll tears down every running engine. Call on executor shutdown.
func (r *Registry) StopAll() {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, re := range r.engines {
		re.Stop(context.Background())
		delete(r.engines, id)
	}
}

// ID returns the rule chain ID.
func (e *Engine) ID() string { return e.chainID }

// Dispatch feeds a message into the chain. msgType is the input kind
// (e.g. "trigger"), data is the JSON payload (may be empty), and meta is
// optional metadata (room, user, etc.) the brain can pass to nodes.
//
// Blocks until the graph settles or ctx fires. A 30s upper bound is also
// applied per-node inside capabilityNode.OnMsg; ctx wins when shorter.
func (e *Engine) Dispatch(ctx context.Context, msgType string, data []byte, meta map[string]string) error {
	m := types.NewMsg(0, msgType, types.JSON, types.NewMetadata(), string(data))
	if len(meta) > 0 {
		for k, v := range meta {
			m.Metadata.PutValue(k, v)
		}
	}
	done := make(chan struct{})
	go func() {
		e.ruleEng.OnMsgAndWait(m)
		close(done)
	}()
	select {
	case <-done:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

// capabilityNode implements types.Node for a HomeSense tool. It satisfies
// every method of the contract: Type/Init/Destroy for registration and
// per-chain creation, New/OnMsg for per-instance execution. Holding the
// caller on the prototype (Type) and the parsed config on the instance
// is the standard RuleGo pattern.
type capabilityNode struct {
	caller     CapabilityCaller
	action     string
	parameters map[string]any
}

// New returns a fresh prototype (no parsed config yet).
func (n *capabilityNode) New() types.Node {
	return &capabilityNode{caller: n.caller}
}

// Type is the JSON "type" field the brain uses in node definitions.
// Convention: "hs/<tool-name>", e.g. "hs/mi_device".
func (n *capabilityNode) Type() string { return "hs/" + n.caller.Name() }

// Destroy is part of the types.Node contract; nothing to free here.
func (n *capabilityNode) Destroy() {}

// Init parses the node's "configuration" from the DSL. Two fields are
// reserved by the engine: "action" (the tool subcommand) and "parameters"
// (an object passed verbatim to the tool). Anything else is folded into
// parameters so simple nodes don't need a nested object.
func (n *capabilityNode) Init(_ types.Config, configuration types.Configuration) error {
	n.parameters = map[string]any{}
	for k, v := range configuration {
		n.parameters[k] = v
	}
	if action, ok := configuration["action"].(string); ok {
		n.action = action
		delete(n.parameters, "action")
	}
	if params, ok := configuration["parameters"].(map[string]any); ok {
		for k, v := range params {
			if _, dup := n.parameters[k]; !dup {
				n.parameters[k] = v
			}
		}
		delete(n.parameters, "parameters")
	}
	return nil
}

// OnMsg invokes the wrapped capability and routes based on success/failure.
// TellSuccess → "Success" relation, TellFailure → "Failure" relation. The
// result map is JSON-encoded into msg.Data for downstream nodes.
func (n *capabilityNode) OnMsg(ctx types.RuleContext, msg types.RuleMsg) {
	start := time.Now()
	// Prefer explicit ctx propagation; rulego does not pass context, so we
	// derive one with a sane upper bound from msg timestamps if needed.
	callCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	result, err := n.caller.Call(callCtx, n.action, n.parameters)
	if err != nil || (result != nil && result["status"] == "error") {
		// Surface the error to downstream nodes via Failure relation.
		payload, _ := json.Marshal(map[string]any{
			"tool":      n.caller.Name(),
			"action":    n.action,
			"error":     errString(err, result),
			"elapsedMs": time.Since(start).Milliseconds(),
		})
		msg.SetBytes(payload)
		msg.Type = "error"
		ctx.TellFailure(msg, err)
		return
	}

	payload, _ := json.Marshal(map[string]any{
		"tool":      n.caller.Name(),
		"action":    n.action,
		"data":      result,
		"elapsedMs": time.Since(start).Milliseconds(),
	})
	msg.SetBytes(payload)
	msg.Type = "success"
	ctx.TellSuccess(msg)
}

// errString picks a human-readable error from either the Go error or the
// tool's "error" field, falling back to "unknown" so downstream filters
// always have something to test.
func errString(err error, result map[string]any) string {
	if err != nil {
		return err.Error()
	}
	if result != nil {
		if e, ok := result["error"].(string); ok && e != "" {
			return e
		}
		if e, ok := result["message"].(string); ok && e != "" {
			return e
		}
	}
	return "unknown"
}
