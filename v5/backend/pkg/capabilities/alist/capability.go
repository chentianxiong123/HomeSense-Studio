package alist

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Capability struct {
	mu       sync.Mutex
	cfg      Config
	registry *Registry
}

func NewCapability() *Capability {
	cfg, err := readConfig()
	if err != nil {
		cfg = Config{}
	}
	registry := NewRegistry()
	registry.Register("local", LocalDriver{})
	registry.Register("webdav", WebDAVDriver{client: http.Client{Timeout: 30 * time.Second}})
	return &Capability{cfg: cfg, registry: registry}
}

func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "netdisk_sync",
		Description: "网盘文件管理：列出目录、获取文件详情、删除文件、复制文件。支持 local（本地文件系统）和 webdav 两种驱动。通过 config 参数配置挂载点。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {
					"type": "string",
					"description": "操作类型：health / list / get / remove / copy"
				},
				"path": {
					"type": "string",
					"description": "虚拟路径（如 /mnt/photos/2024）"
				},
				"dir": {
					"type": "string",
					"description": "删除目标目录（remove 使用）"
				},
				"src_dir": {
					"type": "string",
					"description": "复制源目录（copy 使用）"
				},
				"dst_dir": {
					"type": "string",
					"description": "复制目标目录（copy 使用）"
				},
				"names": {
					"type": "array",
					"items": {"type": "string"},
					"description": "文件名列表（remove/copy 使用）"
				},
				"config": {
					"type": "array",
					"description": "挂载配置（可选，覆盖 ~/.homesense/alist/config.json）",
					"items": {
						"type": "object",
						"properties": {
							"path": {"type": "string"},
							"driver": {"type": "string"},
							"root_path": {"type": "string"},
							"address": {"type": "string"},
							"username": {"type": "string"},
							"password": {"type": "string"},
							"readonly": {"type": "boolean"}
						}
					}
				}
			},
			"required": ["action"]
		}`),
	}
}

func (c *Capability) Handler(ctx context.Context, req *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
	var in CapabilityRequest
	if req.Params != nil && len(req.Params.Arguments) > 0 {
		_ = json.Unmarshal(req.Params.Arguments, &in)
	}

	start := time.Now()
	result := c.dispatch(in)
	elapsed := time.Since(start)

	text := fmt.Sprintf("netdisk_sync %s: %s", in.Action, result["status"])
	if msg, ok := result["message"].(string); ok && msg != "" {
		text += " | " + msg
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: text}},
		StructuredContent: map[string]any{
			"status":     result["status"],
			"error":      result["error"],
			"message":    result["message"],
			"data":       result["data"],
			"action":     in.Action,
			"elapsed_ms": elapsed.Milliseconds(),
		},
	}, result, nil
}

func (c *Capability) dispatch(req CapabilityRequest) map[string]any {
	switch req.Action {
	case "health":
		return c.handleHealth()
	case "list":
		return c.handleList(req)
	case "get":
		return c.handleGet(req)
	case "remove":
		return c.handleRemove(req)
	case "copy":
		return c.handleCopy(req)
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("unknown action: %q", req.Action))
	}
}

func (c *Capability) handleHealth() map[string]any {
	names := c.registry.Names()
	return map[string]any{
		"status": "success",
		"data": map[string]any{
			"status":  "ok",
			"version": version,
			"drivers": names,
			"mounts":  mountPaths(c.cfg),
			"started_at": time.Now().Format(time.RFC3339),
		},
	}
}

func (c *Capability) handleList(req CapabilityRequest) map[string]any {
	cfg := c.getConfig(req)
	path := req.Path
	if path == "" {
		path = "/"
	}
	virtual := virtualEntries(cfg, path)
	if len(virtual) > 0 {
		return map[string]any{
			"status": "success",
			"data": map[string]any{
				"path":     path,
				"provider": "virtual",
				"entries":  virtual,
				"total":    len(virtual),
			},
		}
	}
	mount, rel, err := resolveMount(cfg, path)
	if err != nil {
		return fail("NOT_FOUND", err.Error())
	}
	drv, ok := c.registry.Get(mount.Driver)
	if !ok {
		return fail("NOT_IMPLEMENTED", fmt.Sprintf("driver not registered: %s", mount.Driver))
	}
	entries, err := drv.List(path, rel)
	if err != nil {
		return fail("ERROR", err.Error())
	}
	return map[string]any{
		"status": "success",
		"data": map[string]any{
			"path":      path,
			"provider":  mount.Driver,
			"mount_path": mount.Path,
			"entries":   entries,
			"total":     len(entries),
		},
	}
}

func (c *Capability) handleGet(req CapabilityRequest) map[string]any {
	cfg := c.getConfig(req)
	path := req.Path
	if path == "" {
		path = "/"
	}
	mount, rel, err := resolveMount(cfg, path)
	if err != nil {
		return fail("NOT_FOUND", err.Error())
	}
	drv, ok := c.registry.Get(mount.Driver)
	if !ok {
		return fail("NOT_IMPLEMENTED", fmt.Sprintf("driver not registered: %s", mount.Driver))
	}
	detail, err := drv.Get(path, rel)
	if err != nil {
		return fail("ERROR", err.Error())
	}
	return map[string]any{
		"status": "success",
		"data":   detail,
	}
}

func (c *Capability) handleRemove(req CapabilityRequest) map[string]any {
	if len(req.Names) == 0 {
		return fail("INVALID_PARAMS", "names is required")
	}
	cfg := c.getConfig(req)
	removed := 0
	for _, name := range req.Names {
		target := req.Dir
		if target == "" {
			target = "/"
		}
		mount, rel, err := resolveMount(cfg, target)
		if err != nil {
			continue
		}
		drv, ok := c.registry.Get(mount.Driver)
		if !ok {
			continue
		}
		if err := drv.Remove(target, rel+"/"+name); err != nil {
			continue
		}
		removed++
	}
	return map[string]any{
		"status": "success",
		"data":   map[string]any{"removed": removed},
	}
}

func (c *Capability) handleCopy(req CapabilityRequest) map[string]any {
	if len(req.Names) == 0 {
		return fail("INVALID_PARAMS", "names is required")
	}
	if req.SrcDir == "" || req.DstDir == "" {
		return fail("INVALID_PARAMS", "src_dir and dst_dir are required")
	}
	cfg := c.getConfig(req)
	copied := 0
	for _, name := range req.Names {
		srcPath := req.SrcDir
		dstPath := req.DstDir
		srcMount, srcRel, err := resolveMount(cfg, srcPath)
		if err != nil {
			continue
		}
		dstMount, dstRel, err := resolveMount(cfg, dstPath)
		if err != nil {
			continue
		}
		srcDrv, ok := c.registry.Get(srcMount.Driver)
		if !ok {
			continue
		}
		if srcMount.Path == dstMount.Path {
			if err := srcDrv.Copy(srcPath, srcRel+"/"+name, dstPath, dstRel); err != nil {
				continue
			}
			copied++
			continue
		}
		dstDrv, ok := c.registry.Get(dstMount.Driver)
		if !ok {
			continue
		}
		detail, err := srcDrv.Get(srcPath, srcRel+"/"+name)
		if err != nil || detail.IsDir {
			continue
		}
		_ = dstDrv // cross-mount not fully implemented
		_ = detail
	}
	return map[string]any{
		"status": "success",
		"data":   map[string]any{"copied": copied},
	}
}

func (c *Capability) getConfig(req CapabilityRequest) Config {
	if len(req.Config) > 0 {
		return Config{Mounts: req.Config}
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.cfg
}

func fail(code, msg string) map[string]any {
	return map[string]any{"status": "error", "error": code, "message": msg}
}
