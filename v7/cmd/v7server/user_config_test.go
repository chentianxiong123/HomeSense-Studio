package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/sipeed/picoclaw/pkg/config"
)

// newServerForUserConfig builds a Server with a throwaway data dir so tests
// exercise real Store config.json I/O.
func newServerForUserConfig(t *testing.T) *Server {
	t.Helper()
	dataDir := t.TempDir()
	srv, err := NewServer(ServerConfig{
		DataDir:     dataDir,
		GatewayBase: "http://one-api.test/v1",
		GatewayKey:  "sk-test-root",
		Model:       "auto",
	})
	if err != nil {
		t.Fatalf("NewServer: %v", err)
	}
	t.Cleanup(srv.Close)
	return srv
}

func TestUserConfigTemplateSeededOnRegister(t *testing.T) {
	srv := newServerForUserConfig(t)
	u, err := srv.store.RegisterUser("alice", "Alice", "auto", "sk-alice")
	if err != nil {
		t.Fatalf("RegisterUser: %v", err)
	}
	raw, err := srv.store.LoadUserConfig(u.ID)
	if err != nil {
		t.Fatalf("LoadUserConfig: %v", err)
	}
	var cfg config.Config
	if err := json.Unmarshal(raw, &cfg); err != nil {
		t.Fatalf("template is not valid config JSON: %v", err)
	}
	if cfg.Tools.Exec.Enabled {
		t.Errorf("template must disable exec by default")
	}
}

func TestUserConfigFor_IsolationAndMerge(t *testing.T) {
	srv := newServerForUserConfig(t)
	bobCfg := srv.rootCfg.Clone()
	bobCfg.Tools.Web.Provider = "brave"
	_ = bobCfg

	alice, err := srv.store.RegisterUser("alice", "Alice", "auto", "sk-alice")
	if err != nil {
		t.Fatalf("register alice: %v", err)
	}
	carol, err := srv.store.RegisterUser("carol", "Carol", "auto", "sk-carol")
	if err != nil {
		t.Fatalf("register carol: %v", err)
	}

	// Alice turns on exec in her own file; Carol keeps the baseline (off).
	aliceRaw, _ := srv.store.LoadUserConfig(alice.ID)
	var alicePatch map[string]any
	_ = json.Unmarshal(aliceRaw, &alicePatch)
	toolsObj := alicePatch["tools"].(map[string]any)
	execObj := map[string]any{"enabled": true, "allow_remote": false, "enable_deny_patterns": true}
	toolsObj["exec"] = execObj
	patched, _ := json.Marshal(alicePatch)
	if err := srv.store.SaveUserConfig(alice.ID, patched); err != nil {
		t.Fatalf("save alice config: %v", err)
	}

	ac, err := srv.userConfigFor(alice)
	if err != nil {
		t.Fatalf("userConfigFor alice: %v", err)
	}
	cc, err := srv.userConfigFor(carol)
	if err != nil {
		t.Fatalf("userConfigFor carol: %v", err)
	}

	if !ac.Tools.Exec.Enabled {
		t.Errorf("alice exec should be enabled from her own config")
	}
	if cc.Tools.Exec.Enabled {
		t.Errorf("carol exec must stay disabled (platform baseline) regardless of alice's change")
	}

	// Deep isolation: mutating alice's config must never touch carol's.
	ac.Tools.MCP.Servers = map[string]config.MCPServerConfig{"phone": {Enabled: true, Type: "sse", URL: "http://alice-phone:51122/executor"}}
	if len(cc.Tools.MCP.Servers) != 0 {
		t.Errorf("carol MCP servers mutated by alice edit: %d", len(cc.Tools.MCP.Servers))
	}

	// Per-user model key: each tenant carries its own channel.
	if got := ac.ModelList[0].APIKey(); got != "sk-alice" {
		t.Errorf("alice model key = %q, want sk-alice", got)
	}
	if got := cc.ModelList[0].APIKey(); got != "sk-carol" {
		t.Errorf("carol model key = %q, want sk-carol", got)
	}
	// Same workspace isolation.
	if ac.Agents.Defaults.Workspace == cc.Agents.Defaults.Workspace {
		t.Errorf("workspaces must differ per tenant")
	}
}

func TestUserConfigFor_SafeWorkspaceOverride(t *testing.T) {
	srv := newServerForUserConfig(t)
	u, err := srv.store.RegisterUser("dave", "Dave", "auto", "sk-dave")
	if err != nil {
		t.Fatalf("register: %v", err)
	}
	// Even if a tenant writes a different workspace, the row is authoritative.
	raw, _ := srv.store.LoadUserConfig(u.ID)
	var patch map[string]any
	_ = json.Unmarshal(raw, &patch)
	patch["agents"] = map[string]any{"defaults": map[string]any{
		"workspace": "/etc/passwd-host",
		"model_name": "gpt-999",
	}}
	patched, _ := json.Marshal(patch)
	if err := srv.store.SaveUserConfig(u.ID, patched); err != nil {
		t.Fatalf("save: %v", err)
	}
	dc, err := srv.userConfigFor(u)
	if err != nil {
		t.Fatalf("userConfigFor: %v", err)
	}
	if dc.Agents.Defaults.Workspace != u.Workspace {
		t.Errorf("workspace must be forced from user row, got %q", dc.Agents.Defaults.Workspace)
	}
	if dc.Agents.Defaults.ModelName != "auto" {
		t.Errorf("model forced from user row? got %q", dc.Agents.Defaults.ModelName)
	}
	_ = os.Getenv // keep os import
	_ = filepath.Join
}