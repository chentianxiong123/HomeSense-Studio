// The v6 control plane Server. It embeds picoclaw's AgentLoop and exposes a
// small HTTP API for multi-tenant lifecycle:
//
//   - POST /api/v1/users            register a user (personal SQLite DB +
//     workspace created; NO agent instance yet)
//   - GET  /api/v1/users            list users
//   - GET  /api/v1/users/{id}       get one user
//   - DELETE /api/v1/users/{id}     deactivate a user
//   - POST /api/v1/users/{id}/chat  send a message (lazy agent warm-up)
//   - POST /api/v1/reap             manually run idle reclamation
//   - GET  /api/v1/status           registry/runtime status
//
// Agents are materialized only on first message and reclaimed after an idle
// timeout, so memory tracks *active* users, not registered ones.

package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/sipeed/picoclaw/pkg/agent"
	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/providers"
)

// ServerConfig carries the static wiring for the v6 control plane.
type ServerConfig struct {
	DataDir       string
	NewAPIBase    string
	NewAPIKey     string
	Model         string
	IdleTimeout   time.Duration
	ReapInterval  time.Duration
	ParallelTurns int
	CorpusDir     string
	WebDir        string
}

// Server is the v6 control plane.
type Server struct {
	cfg     ServerConfig
	store   *Store
	loop    *agent.AgentLoop
	bus     *bus.MessageBus
	rootCfg *config.Config

	// sessions mints and resolves v6 login tokens.
	sessions *sessionStore
	// bridge wires the multi-user Pico WebSocket onto the shared message bus.
	bridge *picoBridge
	// web serves the picoclaw SPA frontend.
	web http.Handler

	stop     chan struct{}
	closeOne sync.Once

	// materialize de-duplicates concurrent first-message warm-ups for the
	// same user, so simultaneous requests can't double-add an agent instance.
	materialize singleflight.Group
}

// NewServer builds the embedded picoclaw AgentLoop and manager store.
func NewServer(cfg ServerConfig) (*Server, error) {
	if cfg.CorpusDir == "" {
		cfg.CorpusDir = filepath.Join("testdata", "corpus")
	}
	if cfg.IdleTimeout <= 0 {
		cfg.IdleTimeout = 10 * time.Minute
	}
	if cfg.ReapInterval <= 0 {
		cfg.ReapInterval = 30 * time.Second
	}

	store, err := NewStore(cfg.DataDir, cfg.CorpusDir)
	if err != nil {
		return nil, err
	}

	// Build the root picoclaw config. The AgentLoop is created with a minimal
	// implicit agent; tenant agents are added dynamically via AddUserAgent.
	pcCfg := config.DefaultConfig()
	if cfg.ParallelTurns > 0 {
		pcCfg.Agents.Defaults.MaxParallelTurns = cfg.ParallelTurns
	}
	if cfg.Model != "" {
		pcCfg.Agents.Defaults.ModelName = cfg.Model
	}
	pcCfg.Agents.Defaults.ContextManager = "legacy"
	pcCfg.Agents.Defaults.MaxToolIterations = 8
	pcCfg.Agents.Defaults.SummarizeMessageThreshold = 1000
	pcCfg.Agents.Defaults.SteeringMode = "one-at-a-time"
	pcCfg.Agents.Defaults.RestrictToWorkspace = true
	pcCfg.Session.Dimensions = []string{"chat"}

	// Single model channel through new-api (OpenAI-compatible).
	if cfg.NewAPIBase != "" || cfg.NewAPIKey != "" {
		pcCfg.ModelList = []*config.ModelConfig{{
			ModelName: cfg.Model,
			Provider:  "openai",
			Model:     cfg.Model,
			APIBase:   cfg.NewAPIBase,
			APIKeys:   config.SimpleSecureStrings(cfg.NewAPIKey),
		}}
	}

	mb := bus.NewMessageBus()
	rootProvider := buildRootProvider(pcCfg)
	loop := agent.NewAgentLoop(pcCfg, mb, rootProvider)

	// No eager warm-up: pre-registered users stay dormant in the meta DB and
	// get an agent instance only when they actually send a message
	// (see ensureUserAgent). Memory therefore tracks *active* users.
	ctx := context.Background()

	s := &Server{
		cfg:      cfg,
		store:    store,
		loop:     loop,
		bus:      mb,
		rootCfg:  pcCfg,
		sessions: newSessionStore(),
		stop:     make(chan struct{}),
	}
	bridge, err := newPicoBridge(s, pcCfg, mb)
	if err != nil {
		store.Close()
		return nil, err
	}
	s.bridge = bridge
	if cfg.WebDir != "" {
		s.web = newFrontendHandler(cfg.WebDir)
	}
	go s.runReaper()

	// Drive the AgentLoop bus so background turns (async dispatch) work.
	go func() {
		if err := loop.Run(ctx); err != nil {
			log.Printf("agent loop stopped: %v", err)
		}
	}()

	return s, nil
}

// buildRootProvider creates the provider picoclaw uses for the implicit main
// agent. Tenant agents build their own per-user providers (own token).
func buildRootProvider(cfg *config.Config) providers.LLMProvider {
	if len(cfg.ModelList) == 0 {
		return nil
	}
	p, _, err := providers.CreateProviderFromConfig(cfg.ModelList[0])
	if err != nil {
		log.Printf("root provider init: %v", err)
		return nil
	}
	return p
}

// userAgentConfig maps a stored user row to a picoclaw AgentConfig.
func userAgentConfig(u User) *config.AgentConfig {
	ac := &config.AgentConfig{
		ID:        u.ID,
		Name:      u.Name,
		Workspace: u.Workspace,
	}
	if u.Model != "" {
		ac.Model = &config.AgentModelConfig{Primary: u.Model}
	}
	return ac
}

// userProviderFor builds a per-user provider (own token through new-api) or nil
// to fall back to the root config resolution.
func userProviderFor(cfg *config.Config, u User) providers.LLMProvider {
	if u.APIKey == "" || len(cfg.ModelList) == 0 {
		return nil
	}
	base := cfg.ModelList[0].APIBase
	modelCfg := &config.ModelConfig{
		ModelName: cfg.ModelList[0].ModelName,
		Provider:  "openai",
		Model:     cfg.ModelList[0].Model,
		APIBase:   base,
	}
	if modelCfg.APIBase == "" {
		modelCfg.APIBase = base
	}
	modelCfg.APIKeys = config.SimpleSecureStrings(u.APIKey)
	p, _, err := providers.CreateProviderFromConfig(modelCfg)
	if err != nil {
		log.Printf("per-user provider init %s: %v", u.ID, err)
		return nil
	}
	return p
}

// ensureUserAgent lazily places a user's agent instance in the registry if it
// is not already present, then refreshes its last-used timestamp. Concurrent
// first messages for the same user are de-duplicated via singleflight so only
// one AddUserAgent happens.
func (s *Server) ensureUserAgent(userID string) (*agent.AgentInstance, error) {
	if inst, ok := s.loop.GetRegistry().GetAgent(userID); ok {
		s.loop.GetRegistry().Touch(userID)
		return inst, nil
	}

	v, err, _ := s.materialize.Do(userID, func() (any, error) {
		if inst, ok := s.loop.GetRegistry().GetAgent(userID); ok {
			s.loop.GetRegistry().Touch(userID)
			return inst, nil
		}

		u, err := s.store.GetUser(userID)
		if err != nil {
			return nil, fmt.Errorf("unknown user %q: %w", userID, err)
		}

		inst, err := s.loop.GetRegistry().AddUserAgent(userAgentConfig(u), userProviderFor(s.rootCfg, u))
		if err != nil {
			return nil, err
		}
		log.Printf("lazily materialized agent %s", userID)
		return inst, nil
	})
	if err != nil {
		return nil, err
	}
	return v.(*agent.AgentInstance), nil
}

// handleChat processes a user message on their (lazily materialized) agent.
func (s *Server) handleChat(ctx context.Context, userID, content, sessionKey string) (string, error) {
	if _, err := s.ensureUserAgent(userID); err != nil {
		return "", err
	}
	return s.loop.ProcessToAgent(ctx, userID, content, sessionKey, "v6-api", userID)
}

// runReaper periodically reclaims idle agent instances.
func (s *Server) runReaper() {
	ticker := time.NewTicker(s.cfg.ReapInterval)
	defer ticker.Stop()
	reg := s.loop.GetRegistry()
	for {
		select {
		case <-s.stop:
			return
		case <-ticker.C:
			cutoff := time.Now().Add(-s.cfg.IdleTimeout)
			idle := reg.IdleAgents(cutoff)
			for _, id := range idle {
				if err := reg.RemoveUserAgent(id); err != nil {
					log.Printf("reap %s: %v", id, err)
				} else {
					log.Printf("reclaimed idle agent %s (idle > %s)", id, s.cfg.IdleTimeout)
				}
			}
		}
	}
}

// Close stops background goroutines.
func (s *Server) Close() {
	s.closeOne.Do(func() {
		close(s.stop)
		s.loop.Stop()
		_ = s.store.Close()
	})
}

// Routes wires the HTTP handlers.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	auth := &authHandlers{srv: s}
	mux.HandleFunc("/api/auth/login", auth.handleLogin)
	mux.HandleFunc("/api/auth/logout", auth.handleLogout)
	mux.HandleFunc("/api/auth/status", auth.handleStatus)
	mux.HandleFunc("/api/v1/users", s.handleUsers)
	mux.HandleFunc("/api/v1/users/", s.handleUserByID)
	mux.HandleFunc("/api/v1/reap", s.handleReap)
	mux.HandleFunc("/api/v1/status", s.handleStatus)
	mux.HandleFunc("/api/gateway/status", s.handleGatewayStatus)
	mux.HandleFunc("/api/gateway/logs", s.handleGatewayLogs)
	mux.HandleFunc("/api/gateway/start", s.handleGatewayAction)
	mux.HandleFunc("/api/gateway/stop", s.handleGatewayAction)
	mux.HandleFunc("/api/gateway/restart", s.handleGatewayAction)
	mux.HandleFunc("/api/gateway/logs/clear", s.handleGatewayClearLogs)
	mux.HandleFunc("/api/sessions", s.handleSessions)
	mux.HandleFunc("/api/sessions/", s.handleSessionByID)
	mux.HandleFunc("/api/models", s.handleModels)
	mux.HandleFunc("/api/models/default", s.handleSetDefaultModel)
	if s.bridge != nil {
		mux.Handle("/pico/", s.bridge.ch)
	}
	if s.web != nil {
		mux.Handle("/", s.web)
	}
	return mux
}

func respondJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

func respondErr(w http.ResponseWriter, code int, msg string) {
	respondJSON(w, code, map[string]any{"error": msg})
}

// handleUsers registers (POST) or lists (GET) users.
func (s *Server) handleUsers(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodPost:
		var body struct {
			ID     string `json:"id"`
			Name   string `json:"name"`
			Model  string `json:"model"`
			APIKey string `json:"api_key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondErr(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
			return
		}
		u, err := s.store.RegisterUser(body.ID, body.Name, firstNonEmpty(body.Model, s.cfg.Model), body.APIKey)
		if err != nil {
			respondErr(w, http.StatusConflict, err.Error())
			return
		}
		respondJSON(w, http.StatusCreated, u)

	case http.MethodGet:
		users, err := s.store.ListUsers()
		if err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, users)

	default:
		respondErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleUserByID handles GET/DELETE for a single user and POST .../{id}/chat.
func (s *Server) handleUserByID(w http.ResponseWriter, r *http.Request) {
	rest := strings.TrimPrefix(r.URL.Path, "/api/v1/users/")
	userID := rest
	suffix := ""
	if i := strings.Index(rest, "/"); i >= 0 {
		userID = rest[:i]
		suffix = rest[i+1:]
	}
	if userID == "" {
		respondErr(w, http.StatusBadRequest, "user id required")
		return
	}

	switch {
	case suffix == "chat" && r.Method == http.MethodPost:
		var body struct {
			Content    string `json:"content"`
			SessionKey string `json:"session_key"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			respondErr(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
			return
		}
		if strings.TrimSpace(body.Content) == "" {
			respondErr(w, http.StatusBadRequest, "content is required")
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Minute)
		defer cancel()
		reply, err := s.handleChat(ctx, userID, body.Content, body.SessionKey)
		if err != nil {
			respondErr(w, http.StatusBadGateway, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"reply": reply})

	case r.Method == http.MethodGet:
		u, err := s.store.GetUser(userID)
		if err != nil {
			respondErr(w, http.StatusNotFound, "user not found")
			return
		}
		respondJSON(w, http.StatusOK, u)

	case r.Method == http.MethodDelete:
		reg := s.loop.GetRegistry()
		if err := reg.RemoveUserAgent(userID); err != nil && !strings.Contains(err.Error(), "not") {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		if err := s.store.RemoveUser(userID); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true})

	default:
		respondErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}

// handleReap manually triggers an idle sweep.
func (s *Server) handleReap(w http.ResponseWriter, r *http.Request) {
	cutoff := time.Now().Add(-s.cfg.IdleTimeout)
	idle := s.loop.GetRegistry().IdleAgents(cutoff)
	for _, id := range idle {
		if err := s.loop.GetRegistry().RemoveUserAgent(id); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	respondJSON(w, http.StatusOK, map[string]any{"reaped": idle})
}

// handleStatus reports registry/runtime state for ops visibility.
func (s *Server) handleStatus(w http.ResponseWriter, _ *http.Request) {
	reg := s.loop.GetRegistry()
	registered, _ := s.store.ListUsers()
	idle := reg.IdleAgents(time.Now().Add(-s.cfg.IdleTimeout))
	respondJSON(w, http.StatusOK, map[string]any{
		"users_registered": len(registered),
		"instances_active": len(reg.ListAgentIDs()),
		"instances_idle":   idle,
		"idle_timeout":     s.cfg.IdleTimeout.String(),
		"reap_interval":    s.cfg.ReapInterval.String(),
	})
}

func firstNonEmpty(a, b string) string {
	if strings.TrimSpace(a) != "" {
		return a
	}
	return b
}

var _ = os.MkdirAll
