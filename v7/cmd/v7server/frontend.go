// SPA frontend serving for the v6 control plane.
//
// The picoclaw web frontend dist is served from a directory (defaulting to
// third_party/picoclaw/web/frontend/dist) with SPA fallback to index.html
// for any path that is not a static asset, so route navigation works without
// a separate reverse proxy.

package main

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// frontendHandler serves the single-page frontend from distDir with SPA
// fallback. Non-GET/HEAD requests and unknown /api/* paths return 404.
type frontendHandler struct {
	rootDir string
	dist    http.FileSystem
	assets  http.Handler
}

// newFrontendHandler builds a handler rooted at distDir.
func newFrontendHandler(distDir string) *frontendHandler {
	return &frontendHandler{
		rootDir: distDir,
		dist:    http.Dir(distDir),
		assets:  http.FileServer(http.Dir(distDir)),
	}
}

func (h *frontendHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}

	if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") ||
		strings.HasPrefix(r.URL.Path, "/pico/") {
		http.NotFound(w, r)
		return
	}

	clean := path.Clean(strings.TrimPrefix(r.URL.Path, "/"))
	if clean == "." {
		clean = ""
	}

	// Serve a real file if it exists.
	if clean != "" {
		f, err := h.dist.Open(clean)
		if err == nil {
			info, _ := f.Stat()
			f.Close()
			if info != nil && !info.IsDir() {
				h.assets.ServeHTTP(w, r)
				return
			}
		}
		// Missing asset-like path: let the file server produce its 404.
		if strings.Contains(path.Base(clean), ".") && !strings.Contains(clean, "/") {
			h.assets.ServeHTTP(w, r)
			return
		}

		// Check whether the request looks like a file (has extension in the
		// final segment) that does not exist → 404, else SPA fallback.
		if dot := strings.Index(path.Base(clean), "."); dot >= 0 {
			ext := path.Base(clean)[dot:]
			if strings.ContainsAny(ext, "abcdefghijklmnopqrstuvwxyz") {
				h.assets.ServeHTTP(w, r)
				return
			}
		}
	}

	// SPA fallback to index.html.
	data, err := os.ReadFile(filepath.FromSlash(path.Join(h.rootDir, "index.html")))
	if err != nil {
		http.Error(w, "frontend dist missing", http.StatusInternalServerError)
		return
	}
	_, _ = w.Write(data)
}

// defaultDistDir returns the in-repo default frontend build directory. It
// walks up from the v7 working directory (v7/) to the repo root so the same
// picoclaw frontend dist is shared with the v6 control plane.
func defaultDistDir() string {
	wd, err := os.Getwd()
	if err != nil {
		return ""
	}
	// When launched from the repo root (bin/v7server), cwd is the root.
	root := filepath.Join(wd, "third_party", "picoclaw", "web", "frontend", "dist")
	if st, err := os.Stat(root); err == nil && st.IsDir() {
		return root
	}
	// When launched from v7/ (default data dir), walk one level up.
	up := filepath.Join(wd, "..", "third_party", "picoclaw", "web", "frontend", "dist")
	if st, err := os.Stat(up); err == nil && st.IsDir() {
		return up
	}
	return ""
}
