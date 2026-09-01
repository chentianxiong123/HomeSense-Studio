package media

import (
	"encoding/json"
	"fmt"
	"html"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	BilibiliAPI = "https://api.bilibili.com"
	BilibiliPass = "https://passport.bilibili.com"
	UserAgent   = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

type Request struct {
	Action        string `json:"action"`
	Keyword       string `json:"keyword,omitempty"`
	Q             string `json:"q,omitempty"`
	Page          int    `json:"page,omitempty"`
	PageSize      int    `json:"page_size,omitempty"`
	Bvid          string `json:"bvid,omitempty"`
	UpstreamID    string `json:"upstream_id,omitempty"`
	Cookie        string `json:"cookie,omitempty"`
	URL           string `json:"url,omitempty"`
	Location      string `json:"location,omitempty"`
	Title         string `json:"title,omitempty"`
	ContentType   string `json:"content_type,omitempty"`
	Control       string `json:"control,omitempty"`
	TargetIP      string `json:"target_ip,omitempty"`
	Timeout       int    `json:"timeout,omitempty"`
	PreferSingle  bool   `json:"prefer_single_track,omitempty"`
	MinDuration   int    `json:"min_duration_sec,omitempty"`
	IdealDuration int    `json:"ideal_duration_sec,omitempty"`
	MaxDuration   int    `json:"max_duration_sec,omitempty"`
	Query         string `json:"query,omitempty"`
	Sources       []any  `json:"sources,omitempty"`
	Limit         int    `json:"limit,omitempty"`
	MaxCandidates int    `json:"max_candidates,omitempty"`
	Mid           int    `json:"mid,omitempty"`
	MediaID       int    `json:"media_id,omitempty"`
	FolderID      int    `json:"folder_id,omitempty"`
	Hit           string `json:"hit,omitempty"`
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

var htmlTagRe = regexp.MustCompile(`<[^>]+>`)

func dataDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".homesense", "media")
}

func credPath() string { return filepath.Join(dataDir(), "bilibili.json") }

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

func currentCookie() string {
	c, err := loadCred()
	if err != nil || c == nil {
		return ""
	}
	return cookieString(c.Cookies)
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

var mediaExtMap = map[string]string{
	".mp3":  "audio/mpeg",
	".m4a":  "audio/mp4",
	".aac":  "audio/aac",
	".flac": "audio/flac",
	".wav":  "audio/wav",
	".ogg":  "audio/ogg",
	".mp4":  "video/mp4",
	".m4v":  "video/mp4",
	".webm": "video/webm",
	".mkv":  "video/x-matroska",
	".mov":  "video/quicktime",
	".avi":  "video/x-msvideo",
	".flv":  "video/x-flv",
	".ts":   "video/mp2t",
	".m3u8": "application/vnd.apple.mpegurl",
	".mpd":  "application/dash+xml",
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

func formatTime(t time.Time) string {
	if t.IsZero() {
		return ""
	}
	return t.Format(time.RFC3339)
}

// unused but kept for reference
var _ = fmt.Sprintf
