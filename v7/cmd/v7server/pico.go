// Pico WebSocket integration for the v7 control plane.
//
// Each user connects to /pico/ws authenticated by a v7 session token. The
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
	"io"
	"net/http"
	"net/url"
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

// v7SessionToken is a per-login opaque token mapping to a v7 user ID.
type v7SessionToken struct {
	token    string
	userID   string
	username string
	issuedAt time.Time
}

// sessionStore keeps issued v7 session tokens in memory.
type sessionStore struct {
	mu     sync.RWMutex
	tokens map[string]v7SessionToken
}

func newSessionStore() *sessionStore {
	return &sessionStore{tokens: make(map[string]v7SessionToken)}
}

func (s *sessionStore) issue(userID, username string) string {
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		panic(fmt.Sprintf("crypto/rand failed: %v", err))
	}
	token := hex.EncodeToString(buf)
	s.mu.Lock()
	s.tokens[token] = v7SessionToken{token: token, userID: userID, username: username, issuedAt: time.Now()}
	s.mu.Unlock()
	return token
}

func (s *sessionStore) lookup(token string) (v7SessionToken, bool) {
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
	picoCfg.SetToken("v7-bearer-token")

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

// resolveUser extracts the v7 session token from the WebSocket request and
// returns the owning user ID. Token sources: Authorization: Bearer header,
// "token.<value>" subprotocol, or ?token= query parameter.
func (b *picoBridge) resolveUser(r *http.Request) (string, bool) {
	token := ""
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		token = strings.TrimPrefix(auth, "Bearer ")
	} else if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "v7 ") {
		token = strings.TrimPrefix(auth, "v7 ")
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

// gatewayClient is a shared HTTP client that carries the one-api session
// cookie jar so v7 can act on behalf of the logged-in user to mint tokens.
type gatewayClient struct {
	client *http.Client
	jar    http.CookieJar
}

func newGatewayClient() *gatewayClient {
	jar := &cookieJar{}
	return &gatewayClient{
		client: &http.Client{Timeout: 15 * time.Second, Jar: jar},
		jar:    jar,
	}
}

// cookieJar is a minimal in-memory cookie jar (stdlib cookie.Jar requires a
// public suffix list; this one keeps cookies verbatim for the one-api host).
type cookieJar struct {
	mu      sync.RWMutex
	cookies map[string][]*http.Cookie
}

func (j *cookieJar) SetCookies(u *url.URL, cookies []*http.Cookie) {
	j.mu.Lock()
	defer j.mu.Unlock()
	if j.cookies == nil {
		j.cookies = make(map[string][]*http.Cookie)
	}
	host := u.Host
	if host == "" {
		return
	}
	for _, c := range cookies {
		kept := j.cookies[host][:0]
		for _, existing := range j.cookies[host] {
			if existing.Name == c.Name {
				continue
			}
			kept = append(kept, existing)
		}
		j.cookies[host] = append(kept, c)
	}
}

func (j *cookieJar) Cookies(u *url.URL) []*http.Cookie {
	j.mu.RLock()
	defer j.mu.RUnlock()
	return j.cookies[u.Host]
}

func (g *gatewayClient) postJSON(url string, body, into any) (*http.Response, error) {
	b, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	resp, err := g.client.Do(req)
	if err != nil {
		return nil, err
	}
	if into != nil {
		defer resp.Body.Close()
		if err := json.NewDecoder(resp.Body).Decode(into); err != nil {
			return nil, err
		}
	}
	return resp, nil
}

// oneAPILoginResponse mirrors one-api's /api/user/login response. Unlike
// new-api, the user object sits directly on Data (no nested .user), and
// session state lives in a cookie, not an access_token.
type oneAPILoginResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    struct {
		Id       int64   `json:"id"`
		Username string  `json:"username"`
		Quota    float64 `json:"quota"`
		Role     int     `json:"role"`
		Status   int     `json:"status"`
	} `json:"data"`
}

// mintPerUserKey logs the user into one-api (cookie session) and creates a
// per-user token, returning its key. This is done for the freshly-created
// one-api account during registration; the login response itself carries no
// API key, so we always mint here.
func (h *authHandlers) mintPerUserKey(username, password string) (string, error) {
	gc := newGatewayClient()

	var loginResp oneAPILoginResponse
	loginURL := adminBase(h.srv.cfg.GatewayBase) + "/api/user/login"
	resp, err := gc.postJSON(loginURL, map[string]string{"username": username, "password": password}, &loginResp)
	if err != nil {
		return "", fmt.Errorf("one-api login: %w", err)
	}
	if resp.StatusCode != http.StatusOK || !loginResp.Success || loginResp.Data.Id == 0 {
		body, _ := io.ReadAll(resp.Body)
		return "", fmt.Errorf("one-api login failed: %s", strings.TrimSpace(string(body)))
	}
	defer resp.Body.Close()

	// Token creation binds to the logged-in session user (ctxkey.Id), so the
	// same cookie jar that just authenticated creates the per-user key.
	var tokResp struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
		Data    struct {
			Key string `json:"key"`
		} `json:"data"`
	}
	tokURL := adminBase(h.srv.cfg.GatewayBase) + "/api/token/"
	tresp, err := gc.postJSON(tokURL, map[string]any{
		"name":            username + "-v7",
		"unlimited_quota": true,
		"expired_time":    -1,
	}, &tokResp)
	if err != nil {
		return "", fmt.Errorf("one-api token: %w", err)
	}
	if tresp.StatusCode != http.StatusOK || !tokResp.Success || tokResp.Data.Key == "" {
		body, _ := io.ReadAll(tresp.Body)
		return "", fmt.Errorf("one-api token creation failed: %s", strings.TrimSpace(string(body)))
	}
	defer tresp.Body.Close()
	return tokResp.Data.Key, nil
}

// authHandlers are the v7 login/logout/status endpoints. Login proxies to
// one-api's /api/user/login and mints a v7 session token bound to that user.
type authHandlers struct {
	srv *Server
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
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

	// Proxy to one-api login (management API, no /v1 suffix). Session state is
	// a cookie; we keep the connection alive only long enough to read the id.
	gc := newGatewayClient()
	var na oneAPILoginResponse
	loginURL := adminBase(h.srv.cfg.GatewayBase) + "/api/user/login"
	resp, err := gc.postJSON(loginURL, loginRequest{Username: req.Username, Password: req.Password}, &na)
	if err != nil {
		respondErr(w, http.StatusBadGateway, "one-api unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !na.Success || na.Data.Id == 0 {
		msg := na.Message
		if msg == "" {
			msg = "invalid credentials"
		}
		respondErr(w, http.StatusUnauthorized, msg)
		return
	}

	userID := "u" + strconv.FormatInt(na.Data.Id, 10)
	username := na.Data.Username
	if username == "" {
		username = userID
	}

	// Ensure the v7 user row + workspace exist (agent materializes lazily).
	// The user's per-user one-api key is looked up from the meta DB; if it is
	// missing (e.g. the row predates v7 key minting), fall back to the shared
	// gateway key so the chat still works.
	apiKey := h.srv.cfg.GatewayKey
	if _, err := h.srv.store.GetUser(userID); err != nil {
		if _, rerr := h.srv.store.RegisterUser(userID, username, h.srv.cfg.Model, apiKey); rerr != nil {
			respondErr(w, http.StatusInternalServerError, "register v7 user: "+rerr.Error())
			return
		}
	} else if u, gerr := h.srv.store.GetUser(userID); gerr == nil && u.APIKey != "" {
		apiKey = u.APIKey
	}

	token := h.srv.sessions.issue(userID, username)
	respondJSON(w, http.StatusOK, map[string]any{
		"token":    token,
		"user_id":  userID,
		"username": username,
		"model":    h.srv.cfg.Model,
		"gateway":  "one-api",
	})
}

// handleRegister creates a one-api account and mints its per-user key, then
// logs the new user in. Returns the same shape as handleLogin.
func (h *authHandlers) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		respondErr(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if strings.TrimSpace(req.Username) == "" || req.Password == "" {
		respondErr(w, http.StatusBadRequest, "username and password are required")
		return
	}

	// Create the account in one-api.
	gc := newGatewayClient()
	var regResp struct {
		Success bool   `json:"success"`
		Message string `json:"message"`
	}
	regURL := adminBase(h.srv.cfg.GatewayBase) + "/api/user/register"
	resp, err := gc.postJSON(regURL, map[string]string{
		"username": req.Username,
		"password": req.Password,
	}, &regResp)
	if err != nil {
		respondErr(w, http.StatusBadGateway, "one-api unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK || !regResp.Success {
		msg := regResp.Message
		if msg == "" {
			msg = "registration failed"
		}
		respondErr(w, http.StatusConflict, msg)
		return
	}

	// Mint the per-user key now (one-api returns none on register).
	key, err := h.mintPerUserKey(req.Username, req.Password)
	if err != nil {
		respondErr(w, http.StatusBadGateway, err.Error())
		return
	}

	// Log the new user in to establish the v7 session.
	var na oneAPILoginResponse
	loginURL := adminBase(h.srv.cfg.GatewayBase) + "/api/user/login"
	lresp, err := newGatewayClient().postJSON(loginURL, loginRequest{Username: req.Username, Password: req.Password}, &na)
	if err != nil {
		respondErr(w, http.StatusBadGateway, "one-api login after register: "+err.Error())
		return
	}
	defer lresp.Body.Close()
	if lresp.StatusCode != http.StatusOK || !na.Success || na.Data.Id == 0 {
		respondErr(w, http.StatusBadGateway, "login after register failed")
		return
	}

	userID := "u" + strconv.FormatInt(na.Data.Id, 10)
	if _, err := h.srv.store.GetUser(userID); err != nil {
		if _, rerr := h.srv.store.RegisterUser(userID, req.Username, h.srv.cfg.Model, key); rerr != nil {
			respondErr(w, http.StatusInternalServerError, "register v7 user: "+rerr.Error())
			return
		}
	}

	token := h.srv.sessions.issue(userID, req.Username)
	respondJSON(w, http.StatusOK, map[string]any{
		"token":    token,
		"user_id":  userID,
		"username": req.Username,
		"model":    h.srv.cfg.Model,
		"gateway":  "one-api",
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

// adminBase strips any trailing /v1 (OpenAI-compatible suffix) so one-api's
// management API (/api/...) is reached at the server root.
func adminBase(gatewayBase string) string {
	return strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(gatewayBase), "/"), "/v1")
}

func bearerToken(r *http.Request) string {
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimPrefix(auth, "Bearer ")
	}
	if auth := r.Header.Get("Authorization"); strings.HasPrefix(auth, "v7 ") {
		return strings.TrimPrefix(auth, "v7 ")
	}
	return r.URL.Query().Get("token")
}
