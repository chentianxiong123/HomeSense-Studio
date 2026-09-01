package media

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Capability struct{}

func NewCapability() *Capability { return &Capability{} }

func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "media_ctl",
		Description: "媒体控制：B站搜索/信息/登录、DLNA投屏、URL嗅探、资源搜索。B站需通过 bilibili_import_cookie 或 bilibili_qr_start 登录。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {"type": "string", "description": "操作名：search / get_media_info / resolve_audio / bilibili_status / bilibili_import_cookie / bilibili_logout / bilibili_qr_start / bilibili_qr_poll / bilibili_favorite_folders / bilibili_favorite_medias / dlna_discover / dlna_play_url / dlna_control / dlna_status / sniff_url / resource_search / resource_normalize / health"},
				"keyword": {"type": "string", "description": "搜索关键词"},
				"q": {"type": "string", "description": "搜索关键词（别名）"},
				"bvid": {"type": "string", "description": "B站视频BV号"},
				"page": {"type": "integer", "description": "搜索页码"},
				"page_size": {"type": "integer", "description": "每页条数"},
				"cookie": {"type": "string", "description": "B站Cookie字符串或JSON"},
				"url": {"type": "string", "description": "DLNA URL 或嗅探 URL"},
				"location": {"type": "string", "description": "DLNA设备UPnP描述URL"},
				"title": {"type": "string", "description": "DLNA播放标题"},
				"content_type": {"type": "string", "description": "DLNA内容类型"},
				"control": {"type": "string", "description": "DLNA控制命令：play / pause / stop"},
				"target_ip": {"type": "string", "description": "DLNA搜索目标IP"},
				"timeout": {"type": "integer", "description": "超时秒数"},
				"prefer_single_track": {"type": "boolean", "description": "B站搜索偏好单曲"},
				"mid": {"type": "integer", "description": "B站用户mid"},
				"folder_id": {"type": "integer", "description": "收藏夹ID"},
				"media_id": {"type": "integer", "description": "收藏夹ID别名"},
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

	text := fmt.Sprintf("media_ctl %s: %s", in.Action, result["status"])
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

func (c *Capability) dispatch(req Request) map[string]any {
	switch req.Action {
	// Bilibili
	case "search", "search_bilibili", "bilibili_search":
		return searchBilibili(req)
	case "get_media_info", "bilibili_info":
		return getMediaInfo(req)
	case "resolve_audio", "resolve_bilibili_audio":
		return resolveAudio(req)
	// Bilibili Auth
	case "bilibili_status":
		return biliStatus()
	case "bilibili_import_cookie", "bilibili_cookie":
		return biliImportCookie(req)
	case "bilibili_logout":
		return biliLogout()
	case "bilibili_qr_start":
		return biliQRStart()
	case "bilibili_qr_poll":
		return biliQRPoll(req)
	// Bilibili Favorites
	case "bilibili_favorite_folders":
		return biliFavFolders(req)
	case "bilibili_favorite_medias":
		return biliFavMedias(req)
	// DLNA
	case "dlna_discover", "discover_dlna":
		return dlnaDiscover(req)
	case "dlna_play_url", "play_dlna_url":
		return dlnaPlayURL(req)
	case "dlna_control", "control_dlna":
		return dlnaControl(req)
	case "dlna_status", "status_dlna":
		return dlnaStatus(req)
	// Sniff / Resources
	case "sniff_url", "url_sniff":
		return sniffURL(req)
	case "resource_search", "resources_search":
		return resourceSearch(req)
	case "resource_normalize", "resources_normalize":
		return resourceNormalize(req)
	// Health
	case "health":
		return ok(map[string]any{
			"name": "media-cli",
			"providers": []string{"bilibili", "dlna", "resources", "sniff"},
			"actions": []string{
				"search", "get_media_info", "resolve_audio",
				"bilibili_status", "bilibili_import_cookie", "bilibili_logout",
				"bilibili_qr_start", "bilibili_qr_poll",
				"bilibili_favorite_folders", "bilibili_favorite_medias",
				"dlna_discover", "dlna_play_url", "dlna_control", "dlna_status",
				"sniff_url", "resource_search", "resource_normalize",
			},
		})
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("unknown action: %q", req.Action))
	}
}
