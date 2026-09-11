// Frontend compatibility stubs for the picoclaw web UI.
//
// The v6 control plane embeds picoclaw directly (no gateway subprocess), so
// the legacy gateway-management endpoints always report a running, embedded
// gateway. Session listing/history live in sessions.go (real SQLite-backed
// queries on the per-user session store).

package main

import (
	"net/http"
	"time"
)

// handleGatewayStatus reports the gateway as always running (embedded).
func (s *Server) handleGatewayStatus(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"gateway_status":           "running",
		"gateway_start_allowed":    false,
		"gateway_restart_required": false,
		"boot_default_model":       s.cfg.Model,
		"config_default_model":     s.cfg.Model,
		"server_time":              time.Now().UTC().Format(time.RFC3339),
	})
}

func (s *Server) handleGatewayLogs(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"logs":       []any{},
		"log_total":  0,
		"status":     "running",
		"log_run_id": 1,
	})
}

func (s *Server) handleGatewayAction(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"status":    "running",
		"log_total": 0,
	})
}

func (s *Server) handleGatewayClearLogs(w http.ResponseWriter, r *http.Request) {
	respondJSON(w, http.StatusOK, map[string]any{
		"status":    "running",
		"log_total": 0,
	})
}

// handleModels / handleSetDefaultModel live in models.go (real one-api model
// catalog via the per-user token).
