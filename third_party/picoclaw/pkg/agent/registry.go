package agent

import (
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/providers"
	"github.com/sipeed/picoclaw/pkg/routing"
	"github.com/sipeed/picoclaw/pkg/tools"
)

// AgentRegistry manages multiple agent instances and routes messages to them.
type AgentRegistry struct {
	cfg      *config.Config
	agents   map[string]*AgentInstance
	lastUsed map[string]time.Time
	resolver *routing.RouteResolver
	mu       sync.RWMutex
}

// NewAgentRegistry creates a registry from config, instantiating all agents.
func NewAgentRegistry(
	cfg *config.Config,
	provider providers.LLMProvider,
) *AgentRegistry {
	registry := &AgentRegistry{
		cfg:      cfg,
		agents:   make(map[string]*AgentInstance),
		lastUsed: make(map[string]time.Time),
		resolver: routing.NewRouteResolver(cfg),
	}

	agentConfigs := cfg.Agents.List
	if len(agentConfigs) == 0 {
		implicitAgent := &config.AgentConfig{
			ID:      "main",
			Default: true,
		}
		instance := NewAgentInstance(implicitAgent, &cfg.Agents.Defaults, cfg, provider)
		registry.agents["main"] = instance
		logger.InfoCF("agent", "Created implicit main agent (no agents.list configured)", nil)
	} else {
		for i := range agentConfigs {
			ac := &agentConfigs[i]
			id := routing.NormalizeAgentID(ac.ID)
			instance := NewAgentInstance(ac, &cfg.Agents.Defaults, cfg, provider)
			registry.agents[id] = instance
			logger.InfoCF("agent", "Registered agent",
				map[string]any{
					"agent_id":  id,
					"name":      ac.Name,
					"workspace": instance.Workspace,
					"model":     instance.Model,
				})
		}
	}

	for _, instance := range registry.agents {
		if instance.ContextBuilder != nil {
			instance.ContextBuilder.WithAgentDiscovery(instance.ID, registry.ListSpawnableAgents)
		}
	}

	return registry
}

// GetAgent returns the agent instance for a given ID.
func (r *AgentRegistry) GetAgent(agentID string) (*AgentInstance, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	id := routing.NormalizeAgentID(agentID)
	agent, ok := r.agents[id]
	return agent, ok
}

// Touch updates the last-used timestamp for an agent (called on every inbound
// message that targets it). This is the basis for idle reclamation.
func (r *AgentRegistry) Touch(agentID string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	id := routing.NormalizeAgentID(agentID)
	if _, ok := r.agents[id]; ok {
		r.lastUsed[id] = time.Now()
	}
}

// AddUserAgent registers a new agent instance at runtime without requiring a
// config reload or process restart. The instance is built from the workspace
// on disk (AGENT.md/SOUL.md/skills/sessions), so an evicted agent's state is
// rehydrated seamlessly.
func (r *AgentRegistry) AddUserAgent(agentCfg *config.AgentConfig, provider providers.LLMProvider) (*AgentInstance, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	id := routing.NormalizeAgentID(agentCfg.ID)
	if id == "" {
		return nil, fmt.Errorf("agent id is required")
	}
	if _, exists := r.agents[id]; exists {
		return nil, fmt.Errorf("agent %q already registered", id)
	}

	instance := NewAgentInstance(agentCfg, &r.cfg.Agents.Defaults, r.cfg, provider)
	r.agents[id] = instance
	r.lastUsed[id] = time.Now()

	logger.InfoCF("agent", "Registered dynamic user agent",
		map[string]any{
			"agent_id":  id,
			"name":      instance.Name,
			"workspace": instance.Workspace,
			"model":     instance.Model,
		})
	return instance, nil
}

// RemoveUserAgent tears down an agent instance at runtime, releasing its
// in-memory resources (provider, sessions). Persisted workspace data on disk
// is untouched, so the agent can be re-added later with full history.
func (r *AgentRegistry) RemoveUserAgent(agentID string) error {
	r.mu.Lock()
	id := routing.NormalizeAgentID(agentID)
	instance, ok := r.agents[id]
	if ok {
		delete(r.agents, id)
		delete(r.lastUsed, id)
	}
	r.mu.Unlock()

	if !ok {
		return fmt.Errorf("agent %q not registered", id)
	}

	logger.InfoCF("agent", "Removed dynamic user agent",
		map[string]any{"agent_id": id})
	return instance.Close()
}

// EnsureUserAgent lazily (re)creates an agent instance if it is not currently
// registered. If present, it just refreshes the last-used timestamp. This
// implements on-demand warm-up: idle agents are evicted, and the first message
// after eviction transparently rehydrates them from disk.
func (r *AgentRegistry) EnsureUserAgent(agentCfg *config.AgentConfig, provider providers.LLMProvider) (*AgentInstance, error) {
	id := routing.NormalizeAgentID(agentCfg.ID)
	if instance, ok := r.GetAgent(id); ok {
		r.Touch(id)
		return instance, nil
	}
	return r.AddUserAgent(agentCfg, provider)
}

// IdleAgents returns the IDs of agents that have not been used since the given
// cutoff time. Used by the reaper to reclaim idle user instances.
func (r *AgentRegistry) IdleAgents(cutoff time.Time) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var idle []string
	for id, last := range r.lastUsed {
		if last.Before(cutoff) {
			idle = append(idle, id)
		}
	}
	// Deterministic ordering for predictable eviction during tests.
	sort.Strings(idle)
	return idle
}

// ResolveRoute determines which agent handles the normalized inbound context.
func (r *AgentRegistry) ResolveRoute(inbound bus.InboundContext) routing.ResolvedRoute {
	return r.resolver.ResolveRoute(inbound)
}

// ListAgentIDs returns all registered agent IDs.
func (r *AgentRegistry) ListAgentIDs() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	ids := make([]string, 0, len(r.agents))
	for id := range r.agents {
		ids = append(ids, id)
	}
	return ids
}

func (r *AgentRegistry) allowedMCPServers() map[string]struct{} {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if len(r.agents) == 0 {
		return nil
	}

	union := make(map[string]struct{})
	for _, agent := range r.agents {
		if agent == nil {
			continue
		}
		if agent.MCPServerAllowlist == nil {
			return nil
		}
		for serverName := range agent.MCPServerAllowlist {
			union[serverName] = struct{}{}
		}
	}

	return union
}

// CanSpawnSubagent checks if parentAgentID is allowed to spawn targetAgentID.
func (r *AgentRegistry) CanSpawnSubagent(parentAgentID, targetAgentID string) bool {
	parent, ok := r.GetAgent(parentAgentID)
	if !ok {
		return false
	}
	return agentAllowsSubagent(parent, routing.NormalizeAgentID(targetAgentID))
}

func agentAllowsSubagent(parent *AgentInstance, targetNorm string) bool {
	if parent == nil || parent.Subagents == nil || parent.Subagents.AllowAgents == nil {
		return false
	}
	for _, allowed := range parent.Subagents.AllowAgents {
		if allowed == "*" {
			return true
		}
		if routing.NormalizeAgentID(allowed) == targetNorm {
			return true
		}
	}
	return false
}

func agentHasSpawnTool(agent *AgentInstance) bool {
	if agent == nil || agent.Tools == nil {
		return false
	}
	_, ok := agent.Tools.Get("spawn")
	return ok
}

// ForEachTool calls fn for every tool registered under the given name
// across all agents. This is useful for propagating dependencies (e.g.
// MediaStore) to tools after registry construction.
func (r *AgentRegistry) ForEachTool(name string, fn func(tools.Tool)) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, agent := range r.agents {
		if t, ok := agent.Tools.Get(name); ok {
			fn(t)
		}
	}
}

// Close releases resources held by all registered agents.
func (r *AgentRegistry) Close() {
	r.mu.RLock()
	defer r.mu.RUnlock()
	for _, agent := range r.agents {
		if err := agent.Close(); err != nil {
			logger.WarnCF("agent", "Failed to close agent",
				map[string]any{"agent_id": agent.ID, "error": err.Error()})
		}
	}
}

// GetDefaultAgent returns the default agent instance.
func (r *AgentRegistry) GetDefaultAgent() *AgentInstance {
	r.mu.RLock()
	defer r.mu.RUnlock()
	if id := r.defaultAgentIDLocked(); id != "" {
		if agent, ok := r.agents[id]; ok {
			return agent
		}
	}
	for id := range r.agents {
		return r.agents[id]
	}
	return nil
}
