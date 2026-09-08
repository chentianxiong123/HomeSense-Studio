package config

import (
	"testing"
)

func TestCloneDeepCopiesToolsAndMCP(t *testing.T) {
	src := DefaultConfig()
	src.Tools.MCP.Servers = map[string]MCPServerConfig{
		"executor": {
			Enabled: true,
			Type:    "sse",
			URL:     "http://phone:51122/executor",
			Headers: map[string]string{"Authorization": "Bearer tenant-a"},
		},
	}

	dst := src.Clone()
	dst.Tools.Exec.Enabled = false
	dst.Tools.MCP.Servers["executor"] = MCPServerConfig{Enabled: false}

	if src.Tools.Exec.Enabled == dst.Tools.Exec.Enabled {
		t.Errorf("Tools.Exec not deep-copied: src=%v dst=%v", src.Tools.Exec.Enabled, dst.Tools.Exec.Enabled)
	}
	if !src.Tools.MCP.Servers["executor"].Enabled {
		t.Errorf("MCP.Servers map was mutated by clone edit: src got %#v", src.Tools.MCP.Servers["executor"])
	}
	if len(src.Tools.MCP.Servers) != 1 {
		t.Errorf("MCP.Servers length mismatch: %d", len(src.Tools.MCP.Servers))
	}
	src.Tools.MCP.Servers = map[string]MCPServerConfig{
		"executor": {Enabled: true, Type: "sse", URL: "http://phone:51122/executor", Headers: map[string]string{"Authorization": "Bearer tenant-a"}},
	}
	// Nested Headers map must be isolated too.
	dst2 := src.Clone()
	dst2.Tools.MCP.Servers["executor"].Headers["Authorization"] = "Bearer tenant-b"
	if src.Tools.MCP.Servers["executor"].Headers["Authorization"] != "Bearer tenant-a" {
		t.Errorf("MCP.Servers nested Headers map shared with source")
	}
}

func TestClonePreservesAPIKeys(t *testing.T) {
	src := DefaultConfig()
	src.ModelList = []*ModelConfig{{
		ModelName: "auto",
		Provider:  "openai",
		Model:     "auto",
		APIBase:   "http://gw:3200/v1",
		APIKeys:   SimpleSecureStrings("sk-very-secret-1"),
	}}

	dst := src.Clone()
	if got := dst.ModelList[0].APIKey(); got != "sk-very-secret-1" {
		t.Fatalf("API key lost in clone: %q", got)
	}
	// Mutating the clone's key must not touch the source.
	dst.ModelList[0].APIKeys = SimpleSecureStrings("sk-secret-2")
	if src.ModelList[0].APIKey() != "sk-very-secret-1" {
		t.Errorf("clone key mutation leaked into source")
	}
	// Slice of *ModelConfig must be isolated.
	dst.ModelList[0].ModelName = "other"
	if src.ModelList[0].ModelName == "other" {
		t.Errorf("ModelList element pointer shared with source")
	}
}

func TestCloneIsolatesSessionsAndAgents(t *testing.T) {
	src := DefaultConfig()
	src.Session.IdentityLinks = map[string][]string{"alice": {"mobile"}}
	src.Agents.Defaults.MaxTokens = 12345

	dst := src.Clone()
	dst.Session.IdentityLinks["alice"] = []string{"desktop"}
	dst.Agents.Defaults.MaxTokens = 99

	if got := src.Session.IdentityLinks["alice"][0]; got != "mobile" {
		t.Errorf("Session.IdentityLinks shared with source: %v", got)
	}
	if src.Agents.Defaults.MaxTokens != 12345 {
		t.Errorf("Agents.Defaults not value-copied: %d", src.Agents.Defaults.MaxTokens)
	}
}

func TestCloneNil(t *testing.T) {
	if got := (*Config)(nil).Clone(); got != nil {
		t.Errorf("nil clone should be nil")
	}
}