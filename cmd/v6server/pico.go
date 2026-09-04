// Pico WebSocket integration for the v6 control plane.
//
// Each user connects to /pico/ws authenticated by a v6 session token. The
// PicoChannel resolves the token to a user ID (UserResolver) and routes every
// inbound message to that user's own agent instance (InboundHandler →
// AgentLoop.ProcessToAgent). Outbound streaming flows back through the shared
// message bus → channel Manager → PicoChannel.Send → broadcastToSession.

package main

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sipeed/picoclaw/pkg/bus"
	"github.com/sipeed/picoclaw/pkg/channels"
	"github.com/sipeed/picoclaw/pkg/channels/pico"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/media"
)

// v6SessionToken is a per-login opaque token mapping to a v6 user ID.
type v6SessionToken struct {
	token    string
	userID   string
	username string
	issuedAt time.Time
}

// sessionStore keeps issued v6 session tokens in memory.
type sessionStore struct {
	mu     sync.RWMutex
	tokens map[string]v6SessionToken
}

func newSessionStore() *sessionStore {
	return &sessionStore{tokens: make(map[string]v6SessionToken)}
}

func (s *sessionStore) issue(userID, username string) string {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	token := hex.EncodeToString(buf)
	s.mu.Lock()
	s.tokens[token] = v6SessionToken{token: token, userID: userID, username: username, issuedAt: time.Now()}
	s.mu.Unlock()
	return token
}

func (s *sessionStore) lookup(token string) (v6SessionToken, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	st, ok := s.tokens[token]
	return st, ok
}

func (s *sessionStore) revoke(token string) {
	s.mu.Lock()
	delete(s.tokens, token)
	s.mu.Unlock()
}

// picoBridge wires a PicoChannel onto the shared message bus for one Server.
type picoBridge struct {
	srv *Server
	mgr *channels.Manager
	ch  *pico.PicoChannel
	// sessionMu serializes turns per session ID so a session never runs two
	// agent turns concurrently (the AgentLoop is synchronous per call).
	sessionMu sync.Map // sessionID -> *sync.Mutex
}

// newPicoBridge builds the channel Manager + PicoChannel and registers the
// channel on the bus. It returns the bridge so Routes() can mount ServeHTTP.
func newPicoBridge(s *Server, pcCfg *config.Config, mb *bus.MessageBus) (*picoBridge, error) {
	mediaStore := media.NewFileMediaStore()

	mgr, err := channels.NewManager(pcCfg, mb, mediaStore)
	if err != nil {
		return nil, fmt.Errorf("channel manager: %w", err)
	}

	// Build the pico channel directly (not via config factory) so we can
	// install the multi-user resolver and inbound handler.
	bc := &config.Channel{
		Enabled: true,
		Type:    config.ChannelPico,
	}
	bc.SetName(config.ChannelPico)

	picoCfg := &config.PicoSettings{
		AllowOrigins: []string{"*"},
		PingInterval: 30,
		ReadTimeout:  60,
		WriteTimeout: 10,
	}
	// NewPicoChannel requires a non-empty token even though UserResolver
	// supersedes it for authentication; any value satisfies the guard.
	picoCfg.SetToken("v6-bearer-token")

	ch, err := pico.NewPicoChannel(bc, picoCfg, mb)
	if err != nil {
		return nil, fmt.Errorf("pico channel: %w", err)
	}

	b := &picoBridge{srv: s, mgr: mgr, ch: ch}
	ch.SetUserResolver(b.resolveUser)
	ch.SetInboundHandler(b.handleInbound)

	mgr.RegisterChannel(config.ChannelPico, ch)
	if err := mgr.StartAll(context.Background()); err != nil {
		return nil, fmt.Errorf("start channels: %w", err)
	}

	s.loop.SetChannelManager(mgr)
	return b, nil
}

// resolveUser extracts the v6 session token from the WebSocket request and
// returns the owning user ID. Token sources: Authorization: Bearer header,
// "token.<value>" subprotocol, or ?token= query parameter.
func (b *picoBridge) resolveUser(r *http.Request) (string, bool) {
	token := ""
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token = strings.TrimPrefix(auth, "Bearer ")
	} else if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "v6 ") {
		token = strings.TrimPrefix(auth, "v6 ")
	}
	if token == "" {
		for _, proto := range strings.Split(r.Header.Get("Sec-WebSocket-Protocol"), ",") {
			proto = strings.TrimSpace(proto)
			if after, ok := strings.CutPrefix(proto, "token."); ok {
				token = after
				break
			}
		}
	}
	if token == "" {
		token = r.URL.Query().Get("token")
	}
	if token == "" {
		return "", false
	}
	st, ok := b.srv.sessions.lookup(token)
	if !ok {
		return "", false
	}
	return st.userID, true
}

// handleInbound delivers an inbound message to the owner's agent instance,
// serialized per session. Outbound streaming is published to the shared bus,
// which the channel Manager routes back to the PicoChannel.
func (b *picoBridge) handleInbound(ctx context.Context, userID, sessionID string, msg pico.PicoMessage) error {
	content, _ := msg.Payload["content"].(string)
	if strings.TrimSpace(content) == "" {
		return fmt.Errorf("empty message content")
	}

	mu, _ := b.sessionMu.LoadOrStore(sessionID, &sync.Mutex{})
	lock := mu.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()

	if _, err := b.srv.ensureUserAgent(userID); err != nil {
		return fmt.Errorf("agent unavailable for %s: %w", userID, err)
	}

	chatID := "pico:" + sessionID
	if _, err := b.srv.loop.ProcessToAgent(ctx, userID, content, sessionID, "pico", chatID); err != nil {
		return err
	}
	return nil
}

// authHandlers are the v6 login/logout/status endpoints. Login proxies to
// new-api's /api/user/login and mints a v6 session token bound to that user.
type authHandlers struct {
	srv *Server
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type newAPILoginResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    struct {
		AccessToken string `json:"access_token"`
		User        struct {
			Id          int64   `json:"id"`
			Username    string  `json:"username"`
			DisplayName string  `json:"display_name"`
			Quota       float64 `json:"quota"`
		} `json:"user"`
	} `json:"data"`
}

func (h *authHandlers) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if strings.TrimSpace(req.Username) == "" || req.Password == "" {
		respondErr(w, http.StatusBadRequest, "username and password are required")
		return
	}

	// Proxy to new-api login.
	body, _ := json.Marshal(loginRequest{Username: req.Username, Password: req.Password})
	loginURL := strings.TrimSuffix(h.srv.cfg.NewAPIBase, "/") + "/api/user/login"
	httpReq, err := http.NewRequestWithContext(r.Context(), http.MethodPost, loginURL, bytes.NewReader(body))
	if err != nil {
		respondErr(w, http.StatusBadGateway, err.Error())
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		respondErr(w, http.StatusBadGateway, "new-api unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()

	var na newAPILoginResponse
	if err := json.NewDecoder(resp.Body).Decode(&na); err != nil {
		respondErr(w, http.StatusBadGateway, "bad new-api response: "+err.Error())
		return
	}
	if !na.Success || na.Data.User.Id == 0 {
		msg := na.Message
		if msg == "" {
			msg = "invalid credentials"
		}
		respondErr(w, http.StatusUnauthorized, msg)
		return
	}

	userID := "u" + strconv.FormatInt(na.Data.User.Id, 10)
	username := na.Data.User.Username
	if username == "" {
		username = userID
	}

	// Ensure the v6 user row + workspace exist (agent materializes lazily).
	if _, err := h.srv.store.GetUser(userID); err != nil {
		if _, rerr := h.srv.store.RegisterUser(userID, username, h.srv.cfg.Model, na.Data.AccessToken); rerr != nil {
			respondErr(w, http.StatusInternalServerError, "register v6 user: "+rerr.Error())
			return
		}
	}

	token := h.srv.sessions.issue(userID, username)
	respondJSON(w, http.StatusOK, map[string]any{
		"token":      token,
		"user_id":    userID,
		"username":   username,
		"model":      h.srv.cfg.Model,
		"new_api_id": na.Data.User.Id,
	})
}

func (h *authHandlers) handleLogout(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token != "" {
		h.srv.sessions.revoke(token)
	}
	respondJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *authHandlers) handleStatus(w http.ResponseWriter, r *http.Request) {
	token := bearerToken(r)
	if token == "" {
		respondErr(w, http.StatusUnauthorized, "missing token")
		return
	}
	st, ok := h.srv.sessions.lookup(token)
	if !ok {
		respondErr(w, http.StatusUnauthorized, "invalid or expired token")
		return
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"user_id":  st.userID,
		"username": st.username,
	})
}

func bearerToken(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "v6 ") {
		return strings.TrimPrefix(auth, "v6 ")
	}
	return r.URL.Query().Get("token")
}
