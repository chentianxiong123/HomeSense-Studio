package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"homesense/alist-driver/internal/driver"
	"homesense/alist-driver/internal/drivers/local"
	"homesense/alist-driver/internal/drivers/webdav"
	"homesense/alist-driver/internal/ipc"
	"homesense/alist-driver/internal/runtime"
	"os"
	"path"
	"sort"
	"strings"
	"time"
)

const version = "homesense-alist-driver-0.1.0"

func main() {
	started := time.Now()
	if len(os.Args) < 2 {
		ipc.Failure(started, 400, "ACTION_REQUIRED", "action is required", false)
		os.Exit(1)
	}

	action := os.Args[1]
	fs := flag.NewFlagSet(action, flag.ContinueOnError)
	fs.SetOutput(os.Stderr)
	pathFlag := fs.String("path", "/", "virtual path")
	dirFlag := fs.String("dir", "", "virtual directory")
	srcDirFlag := fs.String("src-dir", "", "source virtual directory")
	dstDirFlag := fs.String("dst-dir", "", "destination virtual directory")
	namesFlag := fs.String("names", "[]", "JSON array of names")
	configFlag := fs.String("config", "", "runtime config JSON")
	configFileFlag := fs.String("config-file", "", "runtime config file")
	timeoutFlag := fs.Duration("timeout", 30*time.Second, "action timeout")
	_ = configFlag
	_ = configFileFlag

	if err := fs.Parse(os.Args[2:]); err != nil {
		ipc.Failure(started, 400, "INVALID_FLAGS", err.Error(), false)
		os.Exit(1)
	}

	cfg, err := runtime.LoadConfig(fs)
	if err != nil {
		ipc.Failure(started, 400, "CONFIG_ERROR", err.Error(), false)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeoutFlag)
	defer cancel()

	registry := buildRegistry()
	data, err := run(ctx, registry, cfg, action, actionInput{
		Path:   *pathFlag,
		Dir:    *dirFlag,
		SrcDir: *srcDirFlag,
		DstDir: *dstDirFlag,
		Names:  *namesFlag,
	})
	if err != nil {
		code, errCode, retryable := classifyError(err)
		fmt.Fprintln(os.Stderr, err.Error())
		ipc.Failure(started, code, errCode, err.Error(), retryable)
		os.Exit(1)
	}
	ipc.Success(started, data)
}

type actionInput struct {
	Path   string
	Dir    string
	SrcDir string
	DstDir string
	Names  string
}

func buildRegistry() *driver.Registry {
	registry := driver.NewRegistry()
	registry.Register("local", local.Driver{})
	registry.Register("webdav", webdav.Driver{})
	return registry
}

func run(ctx context.Context, registry *driver.Registry, cfg runtime.Config, action string, input actionInput) (any, error) {
	switch action {
	case "health":
		names := registry.Names()
		sort.Strings(names)
		return runtime.HealthResult{
			Status:    "ok",
			Version:   version,
			Drivers:   names,
			Mounts:    runtime.MountPaths(cfg),
			StartedAt: time.Now().Format(time.RFC3339),
		}, nil
	case "list":
		return list(ctx, registry, cfg, input.Path)
	case "get":
		return get(ctx, registry, cfg, input.Path)
	case "remove":
		return remove(ctx, registry, cfg, input.Dir, input.Names)
	case "copy":
		return copyNames(ctx, registry, cfg, input.SrcDir, input.DstDir, input.Names)
	default:
		return nil, fmt.Errorf("unknown action: %s", action)
	}
}

func list(ctx context.Context, registry *driver.Registry, cfg runtime.Config, rawPath string) (runtime.ListResult, error) {
	virtual := runtime.VirtualEntries(cfg, rawPath)
	if len(virtual) > 0 {
		return runtime.ListResult{
			Path:     cleanPath(rawPath),
			Provider: "virtual",
			Entries:  virtual,
			Total:    len(virtual),
		}, nil
	}
	resolved, err := runtime.ResolveMount(cfg, rawPath)
	if err != nil {
		return runtime.ListResult{}, err
	}
	drv, ok := registry.Get(resolved.Mount.Driver)
	if !ok {
		return runtime.ListResult{}, fmt.Errorf("driver not registered: %s", resolved.Mount.Driver)
	}
	entries, err := drv.List(ctx, resolved.Mount, resolved.Rel)
	if err != nil {
		return runtime.ListResult{}, err
	}
	return runtime.ListResult{
		Path:      cleanPath(rawPath),
		Provider:  resolved.Mount.Driver,
		MountPath: resolved.Mount.Path,
		Entries:   entries,
		Total:     len(entries),
	}, nil
}

func get(ctx context.Context, registry *driver.Registry, cfg runtime.Config, rawPath string) (runtime.Detail, error) {
	resolved, err := runtime.ResolveMount(cfg, rawPath)
	if err != nil {
		return runtime.Detail{}, err
	}
	drv, ok := registry.Get(resolved.Mount.Driver)
	if !ok {
		return runtime.Detail{}, fmt.Errorf("driver not registered: %s", resolved.Mount.Driver)
	}
	return drv.Get(ctx, resolved.Mount, resolved.Rel)
}

func remove(ctx context.Context, registry *driver.Registry, cfg runtime.Config, rawDir string, rawNames string) (map[string]any, error) {
	names, err := parseNames(rawNames)
	if err != nil {
		return nil, err
	}
	for _, name := range names {
		target := path.Join(cleanPath(rawDir), name)
		resolved, err := runtime.ResolveMount(cfg, target)
		if err != nil {
			return nil, err
		}
		drv, ok := registry.Get(resolved.Mount.Driver)
		if !ok {
			return nil, fmt.Errorf("driver not registered: %s", resolved.Mount.Driver)
		}
		if err := drv.Remove(ctx, resolved.Mount, resolved.Rel); err != nil {
			return nil, err
		}
	}
	return map[string]any{"removed": len(names)}, nil
}

func copyNames(ctx context.Context, registry *driver.Registry, cfg runtime.Config, srcDir string, dstDir string, rawNames string) (map[string]any, error) {
	names, err := parseNames(rawNames)
	if err != nil {
		return nil, err
	}
	for _, name := range names {
		srcPath := path.Join(cleanPath(srcDir), name)
		src, err := runtime.ResolveMount(cfg, srcPath)
		if err != nil {
			return nil, err
		}
		dst, err := runtime.ResolveMount(cfg, dstDir)
		if err != nil {
			return nil, err
		}
		srcDrv, ok := registry.Get(src.Mount.Driver)
		if !ok {
			return nil, fmt.Errorf("driver not registered: %s", src.Mount.Driver)
		}
		if src.Mount.Path == dst.Mount.Path {
			if err := srcDrv.Copy(ctx, src.Mount, src.Rel, dst.Rel); err != nil {
				return nil, err
			}
			continue
		}
		dstDrv, ok := registry.Get(dst.Mount.Driver)
		if !ok {
			return nil, fmt.Errorf("driver not registered: %s", dst.Mount.Driver)
		}
		detail, err := srcDrv.Get(ctx, src.Mount, src.Rel)
		if err != nil {
			return nil, err
		}
		if detail.IsDir {
			return nil, errors.New("cross-mount directory copy is not implemented in the feasibility slice")
		}
		stream, err := srcDrv.Open(ctx, src.Mount, src.Rel)
		if err != nil {
			return nil, err
		}
		if err := dstDrv.Put(ctx, dst.Mount, dst.Rel, detail.Name, stream); err != nil {
			_ = stream.Close()
			return nil, err
		}
		_ = stream.Close()
	}
	return map[string]any{"copied": len(names)}, nil
}

func parseNames(raw string) ([]string, error) {
	var names []string
	if err := json.Unmarshal([]byte(raw), &names); err != nil {
		if strings.TrimSpace(raw) == "" {
			return nil, errors.New("names is required")
		}
		names = strings.Split(raw, ",")
	}
	filtered := make([]string, 0, len(names))
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" || name == "." || name == ".." || strings.Contains(name, "/") || strings.Contains(name, "\\") {
			return nil, fmt.Errorf("invalid name: %s", name)
		}
		filtered = append(filtered, name)
	}
	if len(filtered) == 0 {
		return nil, errors.New("names is empty")
	}
	return filtered, nil
}

func cleanPath(value string) string {
	value = strings.ReplaceAll(strings.TrimSpace(value), "\\", "/")
	if value == "" {
		value = "/"
	}
	if !strings.HasPrefix(value, "/") {
		value = "/" + value
	}
	return path.Clean(value)
}

func classifyError(err error) (int, string, bool) {
	if errors.Is(err, context.DeadlineExceeded) {
		return 504, "TIMEOUT", true
	}
	if errors.Is(err, context.Canceled) {
		return 499, "CANCELED", true
	}
	msg := strings.ToLower(err.Error())
	if strings.Contains(msg, "401") || strings.Contains(msg, "unauthorized") {
		return 401, "UNAUTHORIZED", false
	}
	if strings.Contains(msg, "403") || strings.Contains(msg, "forbidden") {
		return 403, "FORBIDDEN", false
	}
	if strings.Contains(msg, "404") || strings.Contains(msg, "not found") {
		return 404, "NOT_FOUND", false
	}
	if strings.Contains(msg, "timeout") || strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "connection reset") || strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "network is unreachable") || strings.Contains(msg, "temporary failure") {
		return 502, "NETWORK_ERROR", true
	}
	if strings.Contains(msg, "not registered") || strings.Contains(msg, "not implemented") {
		return 501, "NOT_IMPLEMENTED", false
	}
	if strings.Contains(msg, "permission") || strings.Contains(msg, "readonly") {
		return 403, "FORBIDDEN", false
	}
	if strings.Contains(msg, "not exist") || strings.Contains(msg, "cannot find") || strings.Contains(msg, "no such file") {
		return 404, "NOT_FOUND", false
	}
	return 500, "ALIST_DRIVER_ERROR", false
}
