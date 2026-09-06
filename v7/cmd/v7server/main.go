// v7server is the HomeSense Studio v7 control plane.
//
// It embeds picoclaw's AgentLoop as a library, manages per-user agent
// instances dynamically (hot add/remove), lazily materializes an agent only
// when a user actually sends a message, and reclaims idle instances to keep
// memory proportional to *active* users rather than registered users.
//
// Unlike v6 (which talked to new-api), v7's gateway is one-api: all LLM
// traffic is proxied through the one-api instance, and each tenant's
// per-user API key is minted on that instance.

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
		addr          = flag.String("addr", ":8081", "HTTP listen address for the v7 control plane")
		dataDir       = flag.String("data", "./data", "root directory for user workspaces and the v7 meta DB")
		gatewayBase   = flag.String("gateway-base", "http://localhost:3200", "one-api base URL (OpenAI-compatible, no /v1)")
		gatewayKey    = flag.String("gateway-key", "", "one-api admin token for minting per-user keys and the root model channel")
		model         = flag.String("model", "auto", "model name to request through one-api")
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
		DataDir:      *dataDir,
		GatewayBase:  *gatewayBase,
		GatewayKey:   *gatewayKey,
		Model:        *model,
		IdleTimeout:  *idleTimeout,
		ReapInterval: *reapInterval,
		ParallelTurns: *parallelTurns,
		WebDir:       *webDir,
	})
	if err != nil {
		log.Fatalf("init v7 server: %v", err)
	}

	httpSrv := &http.Server{
		Addr:    *addr,
		Handler: srv.Routes(),
	}

	errCh := make(chan error, 1)
	go func() {
		log.Printf("v7 server listening on %s", *addr)
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
