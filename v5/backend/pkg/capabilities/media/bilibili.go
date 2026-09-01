package media

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

var biliClient = &http.Client{Timeout: 30 * time.Second}

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
	params := url.Values{
		"keyword":     {keyword},
		"search_type": {"video"},
		"page":        {fmt.Sprintf("%d", page)},
		"pagesize":    {fmt.Sprintf("%d", pageSize)},
	}
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
	return ok(map[string]any{
		"keyword":   keyword,
		"page":      page,
		"page_size": pageSize,
		"total":     toInt(data["numResults"]),
		"items":     items,
	})
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
	return ok(map[string]any{
		"bvid":      bvid,
		"aid":       toInt(info["aid"]),
		"cid":       toInt(info["cid"]),
		"title":     cleanText(fmt.Sprintf("%v", info["title"])),
		"play_url":  "https://www.bilibili.com/video/" + bvid,
		"audio_note": "Full audio stream resolution requires wbi signature",
	})
}

func biliStatus() map[string]any {
	c, err := loadCred()
	if err != nil || c == nil {
		return ok(map[string]any{"authenticated": false, "has_saved_login": false})
	}
	cookie := cookieString(c.Cookies)
	data, err := biliGet("/x/web-interface/nav", nil, cookie)
	if err != nil {
		return ok(map[string]any{
			"authenticated": false,
			"has_saved_login": true,
			"source":        c.Source,
			"saved_at":      c.SavedAt,
			"message":       err.Error(),
		})
	}
	isLogin, _ := data["isLogin"].(bool)
	user := map[string]any{}
	if isLogin {
		user = map[string]any{
			"mid":      toInt(data["mid"]),
			"uname":    data["uname"],
			"face":     data["face"],
			"vip_type": toInt(data["vipType"]),
		}
	}
	return ok(map[string]any{
		"authenticated":   isLogin,
		"has_saved_login": true,
		"source":          c.Source,
		"saved_at":        c.SavedAt,
		"user":            user,
	})
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
			URL         string `json:"url"`
			QrcodeKey   string `json:"qrcode_key"`
		} `json:"data"`
	}
	json.Unmarshal(body, &payload)
	if payload.Code != 0 {
		return fail("BILIBILI_QR_FAILED", payload.Msg)
	}
	return ok(map[string]any{
		"url":         payload.Data.URL,
		"qrcode_key":  payload.Data.QrcodeKey,
		"hint":        "请使用哔哩哔哩 App 扫描二维码",
	})
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
		folders = append(folders, map[string]any{
			"id":          toInt(m["id"]),
			"title":       cleanText(fmt.Sprintf("%v", m["title"])),
			"media_count": toInt(m["media_count"]),
		})
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
	data, err := biliGet("/x/v3/fav/resource/list", url.Values{
		"media_id": {fmt.Sprintf("%d", fid)},
		"ps":       {"20"},
	}, cookie)
	if err != nil {
		return fail("BILIBILI_API_ERROR", err.Error())
	}
	rawList, _ := data["medias"].([]any)
	medias := []map[string]any{}
	for _, raw := range rawList {
		m, _ := raw.(map[string]any)
		medias = append(medias, map[string]any{
			"id":    fmt.Sprintf("%v", m["id"]),
			"title": cleanText(fmt.Sprintf("%v", m["title"])),
			"cover": coverURL(fmt.Sprintf("%v", m["cover"])),
			"bvid":  fmt.Sprintf("%v", m["bvid"]),
		})
	}
	return ok(map[string]any{"medias": medias})
}
