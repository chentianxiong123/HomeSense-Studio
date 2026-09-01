package capabilities

import (
	"context"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Capability defines the registry entry for any executor capability.
type Capability struct {
	Name        string
	Description string
	InputSchema any
	Handler     func(ctx context.Context, req *mcp.CallToolRequest, params any) (*mcp.CallToolResult, any, error)
}

// Registry holds all registered capabilities.
type Registry struct {
	mu      sync.RWMutex
	caps    map[string]*Capability
	created time.Time
}

var global *Registry

func init() {
	global = &Registry{
		caps:    make(map[string]*Capability),
		created: time.Now(),
	}
}

// Register adds a capability to the global registry.
func Register(cap *Capability) {
	global.mu.Lock()
	defer global.mu.Unlock()
	global.caps[cap.Name] = cap
}

// Names returns all registered capability names.
func Names() []string {
	global.mu.RLock()
	defer global.mu.RUnlock()
	names := make([]string, 0, len(global.caps))
	for n := range global.caps {
		names = append(names, n)
	}
	return names
}

// Get looks up a capability by name.
func Get(name string) *Capability {
	global.mu.RLock()
	defer global.mu.RUnlock()
	return global.caps[name]
}

// CreatedAt returns the registry creation time.
func CreatedAt() time.Time { return global.created }
