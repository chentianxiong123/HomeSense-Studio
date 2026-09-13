// Per-tenant picoclaw configuration.
//
// Each registered user owns their own config.json (data/users/<id>/config.json)
// that is merged on top of the platform root config at agent materialization
// time. The merge is field-level: keys present in the tenant file override the
// platform value, everything else inherits it. The resulting Config is a fully
// independent deep copy, so one tenant's overrides never leak into another's.

package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"

	"github.com/sipeed/picoclaw/pkg/config"
)

// userConfigTemplateJSON is the baseline every tenant starts from.
// Tool policy is set at the platform level in server.go.
// Tenant config.json only contains user-specific overrides (e.g. MCP servers).
const userConfigTemplateJSON = `{}
`

// userConfigFor renders a tenant's fully independent picoclaw Config. The
// platform root config is deep-cloned, then the tenant's own config.json is
// merged field-by-field on top (via json.Unmarshal, which only touches keys
// present in the file). Workspace and model channel are authoritative from the
// user row: the workspace is the isolation boundary, and the model entry is
// rebuilt with this tenant's per-user key, mirroring userProviderFor.
func (s *Server) userConfigFor(u User) (*config.Config, error) {
	if u.Workspace == "" {
		return nil, fmt.Errorf("user %s has no workspace", u.ID)
	}
	if _, err := s.store.EnsureUserConfigTemplate(u.ID); err != nil {
		return nil, err
	}

	cfg := s.rootCfg.Clone()

	raw, err := s.store.LoadUserConfig(u.ID)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil && len(bytes.TrimSpace(raw)) > 0 {
		if derr := json.Unmarshal(raw, cfg); derr != nil {
			return nil, fmt.Errorf("user %s config: %w", u.ID, derr)
		}
	}

	// Workspace is the tenant isolation boundary — never overridable.
	cfg.Agents.Defaults.Workspace = u.Workspace
	if u.Model != "" {
		cfg.Agents.Defaults.ModelName = u.Model
	}

	// Per-tenant model channel with the user's own key.
	if u.APIKey != "" && len(s.rootCfg.ModelList) > 0 {
		base := s.rootCfg.ModelList[0]
		cfg.ModelList = []*config.ModelConfig{{
			ModelName: firstNonEmpty(u.Model, base.ModelName),
			Provider:  firstNonEmpty(base.Provider, "openai"),
			Model:     firstNonEmpty(u.Model, base.Model),
			APIBase:   base.APIBase,
			APIKeys:   config.SimpleSecureStrings(u.APIKey),
		}}
	} else {
		cfg.ModelList = nil
	}

	return cfg, nil
}

// handleUserConfig serves GET (read the tenant's config.json) and
// handlers the PUT here (atomic write + instance rebuild on next message).
func (s *Server) handleUserConfig(w http.ResponseWriter, r *http.Request, userID string) {
	if _, err := s.store.GetUser(userID); err != nil {
		respondErr(w, http.StatusNotFound, "user not found")
		return
	}

	switch r.Method {
	case http.MethodGet:
		if _, err := s.store.EnsureUserConfigTemplate(userID); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		data, err := s.store.LoadUserConfig(userID)
		if err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(data)

	case http.MethodPut:
		body := http.MaxBytesReader(w, r.Body, 1<<20)
		data, err := io.ReadAll(body)
		if err != nil {
			respondErr(w, http.StatusBadRequest, err.Error())
			return
		}
		if len(bytes.TrimSpace(data)) == 0 {
			data = []byte("{}")
		}
		if !json.Valid(data) {
			respondErr(w, http.StatusBadRequest, "config: invalid JSON")
			return
		}
		var probe config.Config
		if err := json.Unmarshal(data, &probe); err != nil {
			respondErr(w, http.StatusBadRequest, "config: "+err.Error())
			return
		}
		if err := s.store.SaveUserConfig(userID, data); err != nil {
			respondErr(w, http.StatusInternalServerError, err.Error())
			return
		}
		// Drop the tenant's in-memory instance so the change applies on the
		// next message (lazy rebuild reads the new config).
		if s.loop != nil {
			if err := s.loop.GetRegistry().RemoveUserAgent(userID); err != nil {
				log.Printf("config update: reclaim %s: %v", userID, err)
			}
		}
		respondJSON(w, http.StatusOK, map[string]any{"ok": true, "user": userID})

	default:
		respondErr(w, http.StatusMethodNotAllowed, "method not allowed")
	}
}