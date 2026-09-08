// PicoClaw - Ultra-lightweight personal AI agent
// Inspired by and based on nanobot: https://github.com/HKUDS/nanobot
// License: MIT
//
// Copyright (c) 2026 PicoClaw contributors

package agent

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/config"
	runtimeevents "github.com/sipeed/picoclaw/pkg/events"
	"github.com/sipeed/picoclaw/pkg/logger"
	"github.com/sipeed/picoclaw/pkg/mcp"
	"github.com/sipeed/picoclaw/pkg/providers"
	"github.com/sipeed/picoclaw/pkg/tools"
)

type mcpRuntime struct {
	initOnce sync.Once
	mu       sync.Mutex
	manager  *mcp.Manager
	initErr  error
}

func (r *mcpRuntime) reset() *mcp.Manager {
	r.mu.Lock()
	manager := r.manager
	r.manager = nil
	r.initErr = nil
	r.initOnce = sync.Once{}
	r.mu.Unlock()
	return manager
}

func (r *mcpRuntime) setManager(manager *mcp.Manager) {
	r.mu.Lock()
	r.manager = manager
	r.initErr = nil
	r.mu.Unlock()
}

func (r *mcpRuntime) setInitErr(err error) {
	r.mu.Lock()
	r.initErr = err
	r.mu.Unlock()
}

func (r *mcpRuntime) getInitErr() error {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.initErr
}

func (r *mcpRuntime) takeManager() *mcp.Manager {
	r.mu.Lock()
	defer r.mu.Unlock()
	manager := r.manager
	r.manager = nil
	return manager
}

func (r *mcpRuntime) hasManager() bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.manager != nil
}

func (r *mcpRuntime) getManager() *mcp.Manager {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.manager
}

// ensureMCPInitialized loads MCP servers/tools once so both Run() and direct
// agent mode share the same initialization path.
func (al *AgentLoop) ensureMCPInitialized(ctx context.Context) error {
	for _, agentID := range al.registry.ListAgentIDs() {
		agent, ok := al.registry.GetAgent(agentID)
		if !ok {
			continue
		}
		if err := agent.initializeMCP(ctx, al.runtimeEvents, agent.Config); err != nil {
			logger.WarnCF("agent", "MCP initialization failed for agent",
				map[string]any{"agent_id": agentID, "error": err.Error()})
		}
	}
	return nil
}

// initializeMCP loads this agent's own MCP servers (from its config) and
// registers their tools on the agent's tool registry, starting an isolated
// manager so one tenant's servers and credentials never leak into another's.
// It is idempotent: an already-initialized agent is left untouched.
func (a *AgentInstance) initializeMCP(ctx context.Context, events runtimeevents.Bus, cfg *config.Config) error {
	if a == nil || a.Tools == nil {
		return nil
	}
	if cfg == nil {
		cfg = a.Config
	}
	if cfg == nil {
		return nil
	}
	mcpCfg := cfg.Tools.MCP
	if !cfg.Tools.IsToolEnabled("mcp") {
		return nil
	}
	if len(mcpCfg.Servers) == 0 {
		return nil
	}

	selected := filterMCPConfigServers(mcpCfg, a.MCPServerAllowlist)
	if len(selected.Servers) == 0 {
		logger.InfoCF("agent", "No MCP servers selected for agent after allowlist",
			map[string]any{"agent_id": a.ID})
		return nil
	}
	findValidServer := false
	for _, serverCfg := range selected.Servers {
		if serverCfg.Enabled {
			findValidServer = true
			break
		}
	}
	if !findValidServer {
		logger.WarnCF("agent", "MCP enabled but no valid servers configured for agent, skipping",
			map[string]any{"agent_id": a.ID})
		return nil
	}

	a.mcpState.mu.Lock()
	if a.mcpState.manager != nil {
		a.mcpState.mu.Unlock()
		return nil
	}
	manager := mcp.NewManager(mcp.WithRuntimeEvents(events))
	a.mcpState.manager = manager
	a.mcpState.mu.Unlock()

	if err := manager.LoadFromMCPConfig(ctx, selected, a.Workspace); err != nil {
		logger.WarnCF("agent", "Failed to load MCP servers for agent",
			map[string]any{"agent_id": a.ID, "error": err.Error()})
		a.mcpState.mu.Lock()
		a.mcpState.manager = nil
		a.mcpState.mu.Unlock()
		_ = manager.Close()
		return fmt.Errorf("failed to load MCP servers: %w", err)
	}

	servers := manager.GetServers()
	registeredTools := 0
	for serverName, conn := range servers {
		serverCfg := selected.Servers[serverName]
		registerAsHidden := serverIsDeferred(mcpCfg.Discovery.Enabled, serverCfg)
		perServerTools := 0
		for _, tool := range conn.Tools {
			mcpTool := tools.NewMCPTool(manager, serverName, tool)
			mcpTool.SetWorkspace(a.Workspace)
			mcpTool.SetMaxInlineTextRunes(mcpCfg.GetMaxInlineTextChars())
			mcpTool.SetEventPublisher(events)
			if registerAsHidden {
				a.Tools.RegisterHidden(mcpTool)
			} else {
				a.Tools.Register(mcpTool)
			}
			if toolRegistryIncludes(a.Tools, mcpTool.Name()) {
				perServerTools++
			}
		}
		registerMCPServerPromptContributor(a.ID, a, serverName, perServerTools, registerAsHidden)
		registeredTools += perServerTools
	}
	logger.InfoCF("agent", "MCP tools registered for agent",
		map[string]any{"agent_id": a.ID, "server_count": len(servers), "tools": registeredTools})

	// Discovery tools are registered per-agent as well.
	if mcpCfg.Enabled && mcpCfg.Discovery.Enabled {
		useBM25 := mcpCfg.Discovery.UseBM25
		useRegex := mcpCfg.Discovery.UseRegex
		if !useBM25 && !useRegex {
			return fmt.Errorf("tool discovery is enabled but neither use_bm25 nor use_regex is true")
		}
		ttl := mcpCfg.Discovery.TTL
		if ttl <= 0 {
			ttl = 5
		}
		maxResults := mcpCfg.Discovery.MaxSearchResults
		if maxResults <= 0 {
			maxResults = 5
		}
		if useRegex {
			a.Tools.Register(tools.NewRegexSearchTool(a.Tools, ttl, maxResults))
		}
		if useBM25 {
			a.Tools.Register(tools.NewBM25SearchTool(a.Tools, ttl, maxResults))
		}
	}
	return nil
}


func registerMCPServerPromptContributor(
	agentID string,
	agent *AgentInstance,
	serverName string,
	toolCount int,
	registerAsHidden bool,
) {
	if agent == nil || agent.ContextBuilder == nil || toolCount <= 0 {
		return
	}
	if err := agent.ContextBuilder.RegisterPromptContributor(mcpServerPromptContributor{
		serverName: serverName,
		toolCount:  toolCount,
		deferred:   registerAsHidden,
	}); err != nil {
		logger.WarnCF("agent", "Failed to register MCP prompt contributor",
			map[string]any{
				"agent_id": agentID,
				"server":   serverName,
				"error":    err.Error(),
			})
	}
}

func recordRegisteredMCPTool(
	registeredToolsByAgent map[string]map[string]struct{},
	agentID, toolName string,
) {
	if registeredToolsByAgent[agentID] == nil {
		registeredToolsByAgent[agentID] = make(map[string]struct{})
	}
	registeredToolsByAgent[agentID][toolName] = struct{}{}
}

func toolRegistryIncludes(registry *tools.ToolRegistry, name string) bool {
	if registry == nil {
		return false
	}
	return registry.HasRegistered(name)
}

func filterMCPConfigServers(
	mcpCfg config.MCPConfig,
	allowed map[string]struct{},
) config.MCPConfig {
	if allowed == nil {
		return mcpCfg
	}

	filtered := mcpCfg
	filtered.Servers = make(map[string]config.MCPServerConfig)
	normalizedAllowed := make(map[string]struct{}, len(allowed))
	for serverName := range allowed {
		name := normalizeMCPServerName(serverName)
		if name == "" {
			continue
		}
		normalizedAllowed[name] = struct{}{}
	}
	for serverName, serverCfg := range mcpCfg.Servers {
		if _, ok := normalizedAllowed[normalizeMCPServerName(serverName)]; ok {
			filtered.Servers[serverName] = serverCfg
		}
	}

	return filtered
}

func agentHasDiscoverableMCPServers(cfg *config.Config, allowed map[string]struct{}) bool {
	if cfg == nil || !cfg.Tools.MCP.Enabled || !cfg.Tools.MCP.Discovery.Enabled {
		return false
	}

	filtered := filterMCPConfigServers(cfg.Tools.MCP, allowed)
	for _, serverCfg := range filtered.Servers {
		if serverCfg.Enabled && serverIsDeferred(cfg.Tools.MCP.Discovery.Enabled, serverCfg) {
			return true
		}
	}

	return false
}

// serverIsDeferred reports whether an MCP server's tools should be registered
// as hidden (deferred/discovery mode).
//
// The per-server Deferred field takes precedence over the global discoveryEnabled
// default. When Deferred is nil, discoveryEnabled is used as the fallback.
func serverIsDeferred(discoveryEnabled bool, serverCfg config.MCPServerConfig) bool {
	if !discoveryEnabled {
		return false
	}
	if serverCfg.Deferred != nil {
		return *serverCfg.Deferred
	}
	return true
}

// MaterializeUserAgent registers a tenant agent carrying its own per-tenant
// configuration and immediately wires its MCP servers. Multi-tenant control
// planes call this instead of the registry directly so a dynamically added
// agent's MCP runtime is assembled with the same code path as startup.
func (al *AgentLoop) MaterializeUserAgent(
	agentCfg *config.AgentConfig,
	userCfg *config.Config,
	provider providers.LLMProvider,
) (*AgentInstance, error) {
	inst, err := al.registry.AddUserAgentWithConfig(agentCfg, userCfg, provider)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err := inst.initializeMCP(ctx, al.runtimeEvents, userCfg); err != nil {
		logger.WarnCF("agent", "MCP init failed for materialized user agent",
			map[string]any{"agent_id": inst.ID, "error": err.Error()})
	}
	return inst, nil
}
