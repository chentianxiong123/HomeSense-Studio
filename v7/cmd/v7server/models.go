// Model catalog for the chat UI.
//
// The list of models a tenant may pick from is whatever one-api exposes to
// that tenant's per-user token (GET /v1/models). Model availability and
// permissions are managed on the one-api platform; v7 only mirrors the list
// and records the tenant's chosen default model on their user row.

package main

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"time"
)

// oneAPIModelsResponse mirrors one-api's OpenAI-compatible /v1/models list.
type oneAPIModelsResponse struct {
	Data []struct {
		ID string `json:"id"`
	} `json:"data"`
}

// fetchOneAPIModels lists the models the given one-api token may call.
func fetchOneAPIModels(gatewayBase, apiKey string) ([]string, error) {
	if apiKey == "" {
		return nil, fmt.Errorf("no one-api token available")
	}
	url := adminBase(gatewayBase) + "/v1/models"
	req, err := http.NewRequest(http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return nil, fmt.Errorf("one-api models: status %d: %s", resp.StatusCode, string(body))
	}
	var out oneAPIModelsResponse
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, err
	}
	names := make([]string, 0, len(out.Data))
	seen := make(map[string]bool)
	for _, m := range out.Data {
		if m.ID == "" || seen[m.ID] {
			continue
		}
		seen[m.ID] = true
		names = append(names, m.ID)
	}
	return names, nil
}

// userIDForRequest resolves the v7 session token (if any) to a user ID.
func (s *Server) userIDForRequest(r *http.Request) string {
	token := bearerToken(r)
	if token == "" {
		return ""
	}
	if st, ok := s.sessions.lookup(token); ok {
		return st.userID
	}
	return ""
}

// apiKeyForRequest returns the tenant's one-api token, falling back to the
// shared gateway key for anonymous / token-less callers.
func (s *Server) apiKeyForRequest(r *http.Request) string {
	if uid := s.userIDForRequest(r); uid != "" {
		if u, err := s.store.GetUser(uid); err == nil && u.APIKey != "" {
			return u.APIKey
		}
	}
	return s.cfg.GatewayKey
}

// handleModels reports the tenant-visible model catalog from one-api.
func (s *Server) handleModels(w http.ResponseWriter, r *http.Request) {
	models, err := fetchOneAPIModels(s.cfg.GatewayBase, s.apiKeyForRequest(r))
	if err != nil {
		respondErr(w, http.StatusBadGateway, "one-api: "+err.Error())
		return
	}

	defaultModel := s.cfg.Model
	if uid := s.userIDForRequest(r); uid != "" {
		if u, err := s.store.GetUser(uid); err == nil && u.Model != "" {
			defaultModel = u.Model
		}
	}

	list := make([]map[string]any, 0, len(models))
	for i, name := range models {
		list = append(list, map[string]any{
			"index":                 i,
			"model_name":            name,
			"provider":              "one-api",
			"model":                 name,
			"api_base":              s.cfg.GatewayBase,
			"api_key":               "",
			"enabled":               true,
			"available":             true,
			"status":                "available",
			"is_default":            name == defaultModel,
			"is_virtual":            false,
			"default_model_allowed": true,
		})
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"models":           list,
		"total":            len(list),
		"default_model":    defaultModel,
		"default_provider": "one-api",
		"fallback_chain":   []string{},
		"provider_options": []any{},
	})
}

// handleSetDefaultModel persists the tenant's chosen default model and
// rebuilds their agent so the change applies on the next message.
func (s *Server) handleSetDefaultModel(w http.ResponseWriter, r *http.Request) {
	uid := s.userIDForRequest(r)
	if uid == "" {
		respondErr(w, http.StatusUnauthorized, "not authenticated")
		return
	}
	var body struct {
		ModelName string `json:"model_name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		respondErr(w, http.StatusBadRequest, "invalid JSON body: "+err.Error())
		return
	}
	if body.ModelName == "" {
		respondErr(w, http.StatusBadRequest, "model_name is required")
		return
	}
	if err := s.store.UpdateUserModel(uid, body.ModelName); err != nil {
		respondErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	if s.loop != nil {
		if err := s.loop.GetRegistry().RemoveUserAgent(uid); err != nil {
			log.Printf("default model update: reclaim %s: %v", uid, err)
		}
	}
	respondJSON(w, http.StatusOK, map[string]any{
		"status":        "success",
		"default_model": body.ModelName,
	})
}