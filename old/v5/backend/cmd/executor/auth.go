package main

import (
	"crypto/subtle"
	"net/http"
	"os"
	"strings"
)

// executorTokens returns the list of accepted bearer tokens.
// Priority: -token flag > EXECUTOR_TOKEN env. Multiple tokens may be
// comma-separated.
func executorTokens(flagToken string) []string {
	raw := flagToken
	if strings.TrimSpace(raw) == "" {
		raw = os.Getenv("EXECUTOR_TOKEN")
	}
	var toks []string
	for _, part := range strings.Split(raw, ",") {
		if p := strings.TrimSpace(part); p != "" {
			toks = append(toks, p)
		}
	}
	return toks
}

// requireToken guards every request (POST JSON + SSE GET stream) with a
// bearer token. The Streamable HTTP handler serves POST and GET from the same
// endpoint, so a single middleware covers both legs.
func requireToken(tokens []string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got := strings.TrimSpace(r.Header.Get("Authorization"))
		ok := false
		if strings.HasPrefix(got, "Bearer ") {
			g := strings.TrimSpace(got[len("Bearer "):])
			for _, want := range tokens {
				if subtle.ConstantTimeCompare([]byte(g), []byte(want)) == 1 {
					ok = true
					break
				}
			}
		}
		if !ok {
			w.Header().Set("WWW-Authenticate", `Bearer realm="homesense-executor"`)
			w.WriteHeader(http.StatusUnauthorized)
			_, _ = w.Write([]byte(`{"error":"unauthorized"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}