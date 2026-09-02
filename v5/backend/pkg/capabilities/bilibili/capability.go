package bilibili

import (
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	BilibiliAPI  = "https://api.bilibili.com"
	BilibiliPass = "https://passport.bilibili.com"
	UserAgent    = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

var htmlTagRe = regexp.MustCompile(`<[^>]+>`)
var biliClient = &http.Client{Timeout: 30 * time.Second}

type Request struct {
	Action        string `json:"action"`
	Keyword       string `json:"keyword,omitempty"`
	Q             string `json:"q,omitempty"`
	Page          int    `json:"page,omitempty"`
	PageSize      int    `json:"page_size,omitempty"`
	Bvid          string `json:"bvid,omitempty"`
	UpstreamID    string `json:"upstream_id,omitempty"`
	Cookie        string `json:"cookie,omitempty"`
	PreferSingle  bool   `json:"prefer_single_track,omitempty"`
	Mid           int    `json:"mid,omitempty"`
	FolderID      int    `json:"folder_id,omitempty"`
	MediaID       int    `json:"media_id,omitempty"`
}

type BiliItem struct {
	ID          string `json:"id"`
	Source      string `json:"source"`
	Title       string `json:"title"`
	Artist      string `json:"artist"`
	Cover       string `json:"cover"`
	DurationSec int    `json:"duration_sec"`
	UpstreamID  string `json:"upstream_id"`
	UpstreamURL string `json:"upstream_url"`
	PlayCount   int    `json:"play_count"`
}

type Credential struct {
	Cookies map[string]string `json:"cookies"`
	Source  string            `json:"source"`
	SavedAt int64             `json:"saved_at"`
}

type Capability struct{}

func NewCapability() *Capability { return &Capability{} }

func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "bilibili_ctl",
		Description: "B站视频操作：搜索、查询详情、音频解析、扫码/Cookie登录、收藏夹浏览。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {"type": "string", "description": "操作名：search / get_media_info / resolve_audio / bilibili_status / bilibili_import_cookie / bilibili_logout / bilibili_qr_start / bilibili_qr_poll / bilibili_favorite_folders / bilibili_favorite_medias / health"},
				"keyword": {"type": "string", "description": "搜索关键词"},
				"q": {"type": "string", "description": "搜索关键词（别名）"},
				"bvid": {"type": "string", "description": "B站视频BV号"},
				"page": {"type": "integer", "description": "搜索页码"},
				"page_size": {"type": "integer", "description": "每页条数"},
				"cookie": {"type": "string", "description": "B站Cookie字符串或JSON"},
				"prefer_single_track": {"type": "boolean", "description": "搜索偏好单曲"},
				"mid": {"type": "integer", "description": "B站用户mid"},
				"folder_id": {"type": "integer", "description": "收藏夹ID"},
				"media_id": {"type": "integer", "description": "收藏夹ID别名"}
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
	text := fmt.Sprintf("bilibili_ctl %s: %s", in.Action, result["status"])
	if msg, ok := result["message"].(string); ok && msg != "" {
		text += " | " + msg
	}
	return &mcp.CallToolResult{
		Content:         []mcp.Content{&mcp.TextContent{Text: text}},
		StructuredContent: map[string]any{"status": result["status"], "error": result["error"], "message": result["message"], "data": result["data"], "action": in.Action, "elapsed_ms": elapsed.Milliseconds()},
	}, result, nil
}

// Dispatch runs the action and returns the result map. Exposed for callers
// outside the MCP path (e.g. workflow adapters) that need the same logic
// without constructing a CallToolRequest.
func (c *Capability) Dispatch(req Request) map[string]any { return c.dispatch(req) }

func (c *Capability) dispatch(req Request) map[string]any {
	switch req.Action {
	case "search", "search_bilibili", "bilibili_search":
		return searchBilibili(req)
	case "get_media_info", "bilibili_info":
		return getMediaInfo(req)
	case "resolve_audio", "resolve_bilibili_audio":
		return resolveAudio(req)
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
	case "bilibili_favorite_folders":
		return biliFavFolders(req)
	case "bilibili_favorite_medias":
		return biliFavMedias(req)
	case "health":
		return ok(map[string]any{"name": "bilibili_ctl", "providers": []string{"bilibili"}, "actions": []string{"search", "get_media_info", "resolve_audio", "bilibili_status", "bilibili_import_cookie", "bilibili_logout", "bilibili_qr_start", "bilibili_qr_poll", "bilibili_favorite_folders", "bilibili_favorite_medias"}})
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("unknown action: %q", req.Action))
	}
}

func biliHeaders(cookie string) http.Header {
	h := http.Header{}
	h.Set("User-Agent", UserAgent)
	h.Set("Referer", "https://www.bilibili.com/")
	h.Set("Origin", "https://www.bilibili.com")
	h.Set("Accept", "application/json, text/plain, */*")
	h.Set("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
	if cookie != "" {
		h.Set("Cookie", cookie)
	}
	return h
}

func biliGet(path string, params url.Values, cookie string) (map[string]any, error) {
	baseURL := BilibiliAPI + path
	if len(params) > 0 {
		baseURL += "?" + params.Encode()
	}
	req, err := http.NewRequest("GET", baseURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header = biliHeaders(cookie)
	resp, err := biliClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var payload struct {
		Code    int            `json:"code"`
		Message string         `json:"message"`
		Data    map[string]any `json:"data"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, fmt.Errorf("bad response: %s", string(body[:min(len(body), 200)]))
	}
	if payload.Code != 0 {
		return nil, fmt.Errorf("bilibili api error code=%d msg=%s", payload.Code, payload.Message)
	}
	return payload.Data, nil
}

func searchBilibili(req Request) map[string]any {
	keyword := strings.TrimSpace(req.Keyword)
	if keyword == "" {
		keyword = strings.TrimSpace(req.Q)
	}
	if keyword == "" {
		return fail("INVALID_PARAMS", "keyword is required")
	}
	page := req.Page
	if page == 0 {
		page = 1
	}
	pageSize := clampInt(req.PageSize, 1, 50)
	if pageSize == 0 {
		pageSize = 20
	}
	params := url.Values{"keyword": {keyword}, "search_type": {"video"}, "page": {fmt.Sprintf("%d", page)}, "pagesize": {fmt.Sprintf("%d", pageSize)}}
	if req.PreferSingle {
		params.Set("duration", "1")
	}
	data, err := biliGet("/x/web-interface/search/type", params, "")
	if err != nil {
		return fail("BILIBILI_API_ERROR", err.Error())
	}
	rawItems, _ := data["result"].([]any)
	items := []BiliItem{}
	for _, raw := range rawItems {
		m, _ := raw.(map[string]any)
		bvid, _ := m["bvid"].(string)
		if bvid == "" {
			continue
		}
		items = append(items, BiliItem{
			ID:          "bilibili:" + bvid,
			Source:      "bilibili",
			Title:       cleanText(fmt.Sprintf("%v", m["title"])),
			Artist:      cleanText(fmt.Sprintf("%v", m["author"])),
			Cover:       coverURL(fmt.Sprintf("%v", m["pic"])),
			DurationSec: durationToSeconds(m["duration"]),
			UpstreamID:  bvid,
			UpstreamURL: "https://www.bilibili.com/video/" + bvid,
			PlayCount:   toInt(m["play"]),
		})
	}
	return ok(map[string]any{"keyword": keyword, "page": page, "page_size": pageSize, "total": toInt(data["numResults"]), "items": items})
}

func getMediaInfo(req Request) map[string]any {
	bvid := strings.TrimSpace(req.Bvid)
	if bvid == "" {
		bvid = strings.TrimSpace(req.UpstreamID)
	}
	if bvid == "" {
		return fail("INVALID_PARAMS", "bvid is required")
	}
	data, err := biliGet("/x/web-interface/view", url.Values{"bvid": {bvid}}, "")
	if err != nil {
		return fail("BILIBILI_API_ERROR", err.Error())
	}
	owner, _ := data["owner"].(map[string]any)
	stat, _ := data["stat"].(map[string]any)
	return ok(map[string]any{
		"item": BiliItem{
			ID:          "bilibili:" + bvid,
			Source:      "bilibili",
			Title:       cleanText(fmt.Sprintf("%v", data["title"])),
			Artist:      cleanText(fmt.Sprintf("%v", owner["name"])),
			Cover:       coverURL(fmt.Sprintf("%v", data["pic"])),
			DurationSec: toInt(data["duration"]),
			UpstreamID:  bvid,
			UpstreamURL: "https://www.bilibili.com/video/" + bvid,
			PlayCount:   toInt(stat["view"]),
		},
		"aid":         toInt(data["aid"]),
		"cid":         toInt(data["cid"]),
		"description": fmt.Sprintf("%v", data["desc"]),
	})
}

func resolveAudio(req Request) map[string]any {
	bvid := strings.TrimSpace(req.Bvid)
	if bvid == "" {
		bvid = strings.TrimSpace(req.UpstreamID)
	}
	if bvid == "" {
		return fail("INVALID_PARAMS", "bvid is required")
	}
	info, err := biliGet("/x/web-interface/view", url.Values{"bvid": {bvid}}, "")
	if err != nil {
		return fail("BILIBILI_API_ERROR", err.Error())
	}
	return ok(map[string]any{"bvid": bvid, "aid": toInt(info["aid"]), "cid": toInt(info["cid"]), "title": cleanText(fmt.Sprintf("%v", info["title"])), "play_url": "https://www.bilibili.com/video/" + bvid, "audio_note": "Full audio stream resolution requires wbi signature"})
}

func biliStatus() map[string]any {
	c, err := loadCred()
	if err != nil || c == nil {
		return ok(map[string]any{"authenticated": false, "has_saved_login": false})
	}
	cookie := cookieString(c.Cookies)
	data, err := biliGet("/x/web-interface/nav", nil, cookie)
	if err != nil {
		return ok(map[string]any{"authenticated": false, "has_saved_login": true, "source": c.Source, "saved_at": c.SavedAt, "message": err.Error()})
	}
	isLogin, _ := data["isLogin"].(bool)
	user := map[string]any{}
	if isLogin {
		user = map[string]any{"mid": toInt(data["mid"]), "uname": data["uname"], "face": data["face"], "vip_type": toInt(data["vipType"])}
	}
	return ok(map[string]any{"authenticated": isLogin, "has_saved_login": true, "source": c.Source, "saved_at": c.SavedAt, "user": user})
}

func biliImportCookie(req Request) map[string]any {
	cookies := parseCookieText(req.Cookie)
	if _, ok := cookies["SESSDATA"]; !ok {
		return fail("INVALID_PARAMS", "SESSDATA cookie is required")
	}
	cred := &Credential{Cookies: cookies, Source: "manual", SavedAt: time.Now().Unix()}
	if err := saveCred(cred); err != nil {
		return fail("SAVE_FAILED", err.Error())
	}
	cookie := cookieString(cookies)
	data, err := biliGet("/x/web-interface/nav", nil, cookie)
	if err != nil {
		return ok(map[string]any{"authenticated": false, "has_saved_login": true, "source": "manual", "message": err.Error()})
	}
	isLogin, _ := data["isLogin"].(bool)
	return ok(map[string]any{"authenticated": isLogin, "has_saved_login": true, "source": "manual"})
}

func biliLogout() map[string]any {
	clearCred()
	return ok(map[string]any{"authenticated": false})
}

func biliQRStart() map[string]any {
	u := BilibiliPass + "/x/passport-login/web/qrcode/generate"
	req, _ := http.NewRequest("GET", u, nil)
	req.Header = biliHeaders("")
	resp, err := biliClient.Do(req)
	if err != nil {
		return fail("BILIBILI_QR_FAILED", err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"message"`
		Data struct {
			URL       string `json:"url"`
			QrcodeKey string `json:"qrcode_key"`
		} `json:"data"`
	}
	json.Unmarshal(body, &payload)
	if payload.Code != 0 {
		return fail("BILIBILI_QR_FAILED", payload.Msg)
	}
	return ok(map[string]any{"url": payload.Data.URL, "qrcode_key": payload.Data.QrcodeKey, "hint": "请使用哔哩哔哩 App 扫描二维码"})
}

func biliQRPoll(req Request) map[string]any {
	key := req.Q
	if key == "" {
		return fail("INVALID_PARAMS", "qrcode_key is required")
	}
	u := BilibiliPass + "/x/passport-login/web/qrcode/poll"
	params := url.Values{"qrcode_key": {key}}
	req2, _ := http.NewRequest("GET", u+"?"+params.Encode(), nil)
	req2.Header = biliHeaders("")
	resp, err := biliClient.Do(req2)
	if err != nil {
		return fail("BILIBILI_QR_POLL_FAILED", err.Error())
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	var payload struct {
		Code int    `json:"code"`
		Msg  string `json:"message"`
		Data struct {
			URL string `json:"url"`
		} `json:"data"`
	}
	json.Unmarshal(body, &payload)
	switch payload.Code {
	case 0:
		cookies := map[string]string{}
		for _, c := range resp.Cookies() {
			cookies[c.Name] = c.Value
		}
		if len(cookies) > 0 {
			saveCred(&Credential{Cookies: cookies, Source: "qr", SavedAt: time.Now().Unix()})
		}
		return ok(map[string]any{"status": "confirmed", "url": payload.Data.URL})
	case 86090:
		return ok(map[string]any{"status": "scanned", "message": "已扫描，请在手机上确认"})
	case 86038:
		return fail("QR_EXPIRED", "二维码已过期，请重新生成")
	default:
		return ok(map[string]any{"status": "waiting", "message": payload.Msg})
	}
}

func biliFavFolders(req Request) map[string]any {
	cookie := currentCookie()
	if cookie == "" {
		return fail("NOT_AUTHENTICATED", "Bilibili login is required")
	}
	data, err := biliGet("/x/v3/fav/folder/created/list-all", url.Values{"up_mid": {fmt.Sprintf("%d", req.Mid)}}, cookie)
	if err != nil {
		return fail("BILIBILI_API_ERROR", err.Error())
	}
	rawList, _ := data["list"].([]any)
	folders := []map[string]any{}
	for _, raw := range rawList {
		m, _ := raw.(map[string]any)
		folders = append(folders, map[string]any{"id": toInt(m["id"]), "title": cleanText(fmt.Sprintf("%v", m["title"])), "media_count": toInt(m["media_count"])})
	}
	return ok(map[string]any{"folders": folders})
}

func biliFavMedias(req Request) map[string]any {
	cookie := currentCookie()
	if cookie == "" {
		return fail("NOT_AUTHENTICATED", "Bilibili login is required")
	}
	fid := req.FolderID
	if fid == 0 {
		fid = req.MediaID
	}
	if fid == 0 {
		return fail("INVALID_PARAMS", "folder_id or media_id is required")
	}
	data, err := biliGet("/x/v3/fav/resource/list", url.Values{"media_id": {fmt.Sprintf("%d", fid)}, "ps": {"20"}}, cookie)
	if err != nil {
		return fail("BILIBILI_API_ERROR", err.Error())
	}
	rawList, _ := data["medias"].([]any)
	medias := []map[string]any{}
	for _, raw := range rawList {
		m, _ := raw.(map[string]any)
		medias = append(medias, map[string]any{"id": fmt.Sprintf("%v", m["id"]), "title": cleanText(fmt.Sprintf("%v", m["title"])), "cover": coverURL(fmt.Sprintf("%v", m["cover"])), "bvid": fmt.Sprintf("%v", m["bvid"])})
	}
	return ok(map[string]any{"medias": medias})
}

// --- shared helpers ---

func dataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".homesense", "bilibili")
}

func credPath() string { return filepath.Join(dataDir(), "cred.json") }

func loadCred() (*Credential, error) {
	b, err := os.ReadFile(credPath())
	if err != nil {
		return nil, err
	}
	var c Credential
	if err := json.Unmarshal(b, &c); err != nil {
		return nil, err
	}
	return &c, nil
}

func saveCred(c *Credential) error {
	os.MkdirAll(dataDir(), 0o700)
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(credPath(), b, 0o600)
}

func clearCred() { os.Remove(credPath()) }

func currentCookie() string {
	c, err := loadCred()
	if err != nil || c == nil {
		return ""
	}
	return cookieString(c.Cookies)
}

func cookieString(cookies map[string]string) string {
	parts := []string{}
	for k, v := range cookies {
		if v != "" {
			parts = append(parts, k+"="+v)
		}
	}
	return strings.Join(parts, "; ")
}

func parseCookieText(text string) map[string]string {
	raw := strings.TrimSpace(text)
	if raw == "" {
		return nil
	}
	if strings.HasPrefix(raw, "{") {
		var m map[string]any
		if err := json.Unmarshal([]byte(raw), &m); err == nil {
			out := map[string]string{}
			for k, v := range m {
				if s, ok := v.(string); ok {
					out[k] = s
				}
			}
			return out
		}
	}
	out := map[string]string{}
	for _, part := range strings.Split(raw, ";") {
		if !strings.Contains(part, "=") {
			continue
		}
		k, v, _ := strings.Cut(strings.TrimSpace(part), "=")
		if k != "" {
			out[k] = strings.TrimSpace(v)
		}
	}
	return out
}

func cleanText(s string) string {
	return strings.TrimSpace(htmlTagRe.ReplaceAllString(html.UnescapeString(s), ""))
}

func coverURL(s string) string {
	if strings.HasPrefix(s, "//") {
		return "https:" + s
	}
	return s
}

func durationToSeconds(v any) int {
	switch d := v.(type) {
	case float64:
		return int(d)
	case string:
		text := strings.TrimSpace(d)
		if text == "" {
			return 0
		}
		parts := strings.Split(text, ":")
		nums := make([]int, 0, len(parts))
		for _, p := range parts {
			if p == "" {
				continue
			}
			n, err := strconv.Atoi(p)
			if err != nil {
				return 0
			}
			nums = append(nums, n)
		}
		switch len(nums) {
		case 3:
			return nums[0]*3600 + nums[1]*60 + nums[2]
		case 2:
			return nums[0]*60 + nums[1]
		case 1:
			return nums[0]
		}
	}
	return 0
}

func toInt(v any) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case string:
		i, _ := strconv.Atoi(n)
		return i
	}
	return 0
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
