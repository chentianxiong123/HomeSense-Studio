package media

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Request struct {
	Action        string `json:"action"`
	URL           string `json:"url,omitempty"`
	Query         string `json:"query,omitempty"`
	Sources       []any  `json:"sources,omitempty"`
	Limit         int    `json:"limit,omitempty"`
	MaxCandidates int    `json:"max_candidates,omitempty"`
	Hit           string `json:"hit,omitempty"`
}

type Capability struct{}

func NewCapability() *Capability { return &Capability{} }

func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "media_sniff",
		Description: "媒体资源嗅探与搜索：从 URL 提取媒体文件、跨源资源搜索与归一化。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {"type": "string", "description": "操作名：sniff_url / resource_search / resource_normalize / health"},
				"url": {"type": "string", "description": "待嗅探的 URL"},
				"query": {"type": "string", "description": "资源搜索关键词"},
				"sources": {"type": "array", "description": "资源搜索源列表"},
				"limit": {"type": "integer", "description": "搜索条数限制"},
				"max_candidates": {"type": "integer", "description": "嗅探最大候选数"},
				"hit": {"type": "string", "description": "资源归一化目标"}
			},
			"required": ["action"]
		}`),
	}
}

func (c *Capability) Handler(ctx context.Context, req *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
	var in Request
	if req.Params != nil && len(req.Params.Arguments) > 0 {
		_ = json.Unmarshal(req.Params.Arguments, &in)
	}
	start := time.Now()
	result := c.dispatch(in)
	elapsed := time.Since(start)
	text := fmt.Sprintf("media_sniff %s: %s", in.Action, result["status"])
	if msg, ok := result["message"].(string); ok && msg != "" {
		text += " | " + msg
	}
	return &mcp.CallToolResult{
		Content:         []mcp.Content{&mcp.TextContent{Text: text}},
		StructuredContent: map[string]any{"status": result["status"], "error": result["error"], "message": result["message"], "data": result["data"], "action": in.Action, "elapsed_ms": elapsed.Milliseconds()},
	}, result, nil
}

func (c *Capability) dispatch(req Request) map[string]any {
	switch req.Action {
	case "sniff_url", "url_sniff":
		return sniffURL(req)
	case "resource_search", "resources_search":
		return resourceSearch(req)
	case "resource_normalize", "resources_normalize":
		return resourceNormalize(req)
	case "health":
		return ok(map[string]any{"name": "media_sniff", "providers": []string{"resources", "sniff"}, "actions": []string{"sniff_url", "resource_search", "resource_normalize"}})
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("unknown action: %q", req.Action))
	}
}

func sniffURL(req Request) map[string]any {
	u := strings.TrimSpace(req.URL)
	if u == "" {
		return fail("INVALID_PARAMS", "url is required")
	}
	if !strings.HasPrefix(u, "http://") && !strings.HasPrefix(u, "https://") {
		return fail("INVALID_PARAMS", "url must be an http(s) URL")
	}
	maxCandidates := clampInt(req.MaxCandidates, 1, 50)
	if req.MaxCandidates == 0 {
		maxCandidates = 20
	}
	candidates := []map[string]any{}
	if mt, ok := mimeTypeForURL(u); ok {
		candidates = append(candidates, map[string]any{"url": u, "mime_type": mt, "confidence": 0.95})
	}
	if len(candidates) == 0 {
		candidates = append(candidates, map[string]any{"url": u, "mime_type": "application/octet-stream", "confidence": 0.5})
	}
	if len(candidates) > maxCandidates {
		candidates = candidates[:maxCandidates]
	}
	return ok(map[string]any{"url": u, "count": len(candidates), "strategy": "direct-or-page", "candidates": candidates})
}

func resourceSearch(req Request) map[string]any {
	query := strings.TrimSpace(req.Query)
	if query == "" {
		return fail("INVALID_PARAMS", "query is required")
	}
	limit := clampInt(req.Limit, 1, 100)
	if req.Limit == 0 {
		limit = 20
	}
	return ok(map[string]any{"query": query, "count": 0, "hits": []map[string]any{}, "sources": len(req.Sources), "providers": []string{"bilibili", "dlna", "resources"}, "limit": limit})
}

func resourceNormalize(req Request) map[string]any {
	query := strings.TrimSpace(req.Query)
	hit := strings.TrimSpace(req.Hit)
	if query == "" || hit == "" {
		return fail("INVALID_PARAMS", "query and hit are required")
	}
	return ok(map[string]any{"query": query, "hit": hit, "normalized": strings.ToLower(hit)})
}

var mediaExtMap = map[string]string{
	".mp3":  "audio/mpeg", ".m4a":  "audio/mp4", ".aac":  "audio/aac", ".flac": "audio/flac",
	".wav":  "audio/wav",  ".ogg":  "audio/ogg", ".mp4":  "video/mp4", ".m4v":  "video/mp4",
	".webm": "video/webm", ".mkv":  "video/x-matroska", ".mov": "video/quicktime",
	".avi":  "video/x-msvideo", ".flv": "video/x-flv", ".ts": "video/mp2t",
	".m3u8": "application/vnd.apple.mpegurl", ".mpd": "application/dash+xml",
}

func mimeTypeForURL(u string) (string, bool) {
	lower := strings.ToLower(u)
	for ext, mt := range mediaExtMap {
		if strings.Contains(lower, ext+"?") || strings.HasSuffix(lower, ext) {
			return mt, true
		}
	}
	return "", false
}

func clampInt(v, lo, hi int) int {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	return v
}

func fail(code, msg string) map[string]any {
	return map[string]any{"status": "error", "error": code, "message": msg}
}

func ok(data any) map[string]any {
	return map[string]any{"status": "success", "data": data}
}
