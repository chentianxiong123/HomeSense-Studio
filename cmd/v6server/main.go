// v6server is the HomeSense Studio v6 control plane.
//
// It embeds picoclaw's AgentLoop as a library, manages per-user agent
// instances dynamically (hot add/remove), lazily materializes an agent only
// when a user actually sends a message, and reclaims idle instances to keep
// memory proportional to *active* users rather than registered users.

package main

import (
	"context"
	"flag"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"
)

func main() {
	var (
		addr          = flag.String("addr", ":8080", "HTTP listen address for the v6 control plane")
		dataDir       = flag.String("data", "./data", "root directory for user workspaces and the v6 meta DB")
		newAPIBase    = flag.String("newapi-base", "http://localhost:3000", "new-api base URL (OpenAI-compatible)")
		newAPIKey     = flag.String("newapi-key", "", "new-api server-level API key for the shared model channel")
		model         = flag.String("model", "gpt-4o-mini", "model name to request through new-api")
		idleTimeout   = flag.Duration("idle-timeout", 10*time.Minute, "reclaim agent instances idle longer than this")
		reapInterval  = flag.Duration("reap-interval", 30*time.Second, "interval between idle reclamation sweeps")
		parallelTurns = flag.Int("parallel-turns", 8, "MaxParallelTurns for the AgentLoop (process-global turn concurrency)")
		webDir        = flag.String("web-dir", "", "frontend dist directory to serve (default: in-repo picoclaw frontend dist)")
	)
	flag.Parse()
	if *webDir == "" {
		*webDir = defaultDistDir()
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	srv, err := NewServer(ServerConfig{
		DataDir:       *dataDir,
		NewAPIBase:    *newAPIBase,
		NewAPIKey:     *newAPIKey,
		Model:         *model,
		IdleTimeout:   *idleTimeout,
		ReapInterval:  *reapInterval,
		ParallelTurns: *parallelTurns,
		WebDir:        *webDir,
	})
	if err != nil {
		log.Fatalf("init v6 server: %v", err)
	}

	httpSrv := &http.Server{
		Addr:    *addr,
		Handler: srv.Routes(),
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("v6 server listening on %s", *addr)
		errCh <- httpSrv.ListenAndServe()
	}()

	select {
	case <-ctx.Done():
		log.Println("shutting down...")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = httpSrv.Shutdown(shutdownCtx)
		srv.Close()
	case err := <-errCh:
		log.Fatalf("http server error: %v", err)
	}
}
