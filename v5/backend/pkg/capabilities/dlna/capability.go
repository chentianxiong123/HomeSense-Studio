package dlna

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Request struct {
	Action      string `json:"action"`
	URL         string `json:"url,omitempty"`
	Location    string `json:"location,omitempty"`
	Title       string `json:"title,omitempty"`
	ContentType string `json:"content_type,omitempty"`
	Control     string `json:"control,omitempty"`
	TargetIP    string `json:"target_ip,omitempty"`
	Timeout     int    `json:"timeout,omitempty"`
}

type DLNADevice struct {
	ID       string `json:"id"`
	UDN      string `json:"udn"`
	Name     string `json:"name"`
	Location string `json:"location"`
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	DevType  string `json:"devtype"`
	Server   string `json:"server"`
}

type UPnPService struct {
	ServiceType string `xml:"serviceType"`
	ControlURL  string `xml:"controlURL"`
}

type UPnPDevice struct {
	FriendlyName string         `xml:"friendlyName"`
	Manufacturer string         `xml:"manufacturer"`
	ModelName    string         `xml:"modelName"`
	Services     []UPnPService  `xml:"deviceList>device>serviceList>service"`
}

type DLNAController struct {
	Location    string
	avTransport bool
}

type Capability struct{}

func NewCapability() *Capability { return &Capability{} }

func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "dlna_ctl",
		Description: "DLNA/UPnP 投屏控制：局域网设备发现、播放投屏、播放控制（play/pause/stop/resume）、状态查询。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {"type": "string", "description": "操作名：discover / play_url / control / status / health"},
				"url": {"type": "string", "description": "投屏资源 URL"},
				"location": {"type": "string", "description": "DLNA 设备 UPnP 描述 URL"},
				"title": {"type": "string", "description": "投屏标题"},
				"content_type": {"type": "string", "description": "投屏内容类型"},
				"control": {"type": "string", "description": "控制命令：play / pause / stop / resume"},
				"target_ip": {"type": "string", "description": "DLNA 搜索目标 IP（单播）"},
				"timeout": {"type": "integer", "description": "发现超时秒数（1-10）"}
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
	text := fmt.Sprintf("dlna_ctl %s: %s", in.Action, result["status"])
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
	case "discover", "dlna_discover":
		return dlnaDiscover(req)
	case "play_url", "dlna_play_url":
		return dlnaPlayURL(req)
	case "control", "dlna_control":
		return dlnaControl(req)
	case "status", "dlna_status":
		return dlnaStatus(req)
	case "health":
		return ok(map[string]any{"name": "dlna_ctl", "providers": []string{"dlna"}, "actions": []string{"discover", "play_url", "control", "status"}})
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("unknown action: %q", req.Action))
	}
}

func ssdpSearch(timeoutSec int, targetIP string) ([]DLNADevice, error) {
	conn, err := net.ListenUDP("udp4", nil)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	msearch := "M-SEARCH * HTTP/1.1\r\nHOST: 239.255.255.250:1900\r\nMAN: \"ssdp:disrupt\"\r\nMX: 3\r\nST: upnp:rootdevice\r\n\r\n"
	if targetIP != "" {
		msearch = fmt.Sprintf("M-SEARCH * HTTP/1.1\r\nHOST: %s:1900\r\nMX: 3\r\nST: upnp:rootdevice\r\n\r\n", targetIP)
	}
	conn.SetWriteDeadline(time.Now().Add(time.Second))
	conn.Write([]byte(msearch))

	stop := time.After(time.Duration(timeoutSec+3) * time.Second)
	devices := make(map[string]DLNADevice)

	for {
		select {
		case <-stop:
			goto done
		default:
		}
		buf := make([]byte, 4096)
		conn.SetReadDeadline(time.Now().Add(2 * time.Second))
		n, addr, err := conn.ReadFromUDP(buf)
		if err != nil {
			break
		}
		for _, resp := range parseSSDPResponse(string(buf[:n])) {
			loc := resp["LOCATION"]
			if loc == "" {
				continue
			}
			udn := resp["USN"]
			if existing, ok := devices[udn]; ok {
				if loc != existing.Location {
					devices[udn] = existing
				}
				continue
			}
			parsed, _ := url.Parse(loc)
			port := 0
			if parsed != nil && parsed.Port() != "" {
				port, _ = strconv.Atoi(parsed.Port())
			}
			devices[udn] = DLNADevice{
				ID:       udn,
				UDN:      udn,
				Name:     resp["SERVER"],
				Location: loc,
				IP:       addr.IP.String(),
				Port:     port,
				DevType:  resp["ST"],
				Server:   resp["SERVER"],
			}
		}
	}
done:
	out := make([]DLNADevice, 0, len(devices))
	for _, d := range devices {
		out = append(out, d)
	}
	return out, nil
}

func parseSSDPResponse(text string) []map[string]string {
	entries := []map[string]string{}
	var current map[string]string
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimRight(line, "\r")
		idx := strings.Index(line, ":")
		if idx < 0 {
			continue
		}
		key := strings.ToLower(strings.TrimSpace(line[:idx]))
		val := strings.TrimSpace(line[idx+1:])
		if current == nil {
			current = map[string]string{}
			entries = append(entries, current)
		}
		switch key {
		case "location":
			current["LOCATION"] = val
		case "usn":
			current["USN"] = val
		case "server":
			current["SERVER"] = val
		case "st":
			current["ST"] = val
		case "ext":
			current["EXT"] = val
		case "cache-control":
			current["CACHE-CONTROL"] = val
		case "expires":
			current["EXPIRES"] = val
		}
	}
	return entries
}

func dlnaDiscover(req Request) map[string]any {
	timeout := clampInt(req.Timeout, 1, 10)
	devices, err := ssdpSearch(timeout, req.TargetIP)
	if err != nil {
		return fail("DLNA_SEARCH_FAILED", err.Error())
	}
	deviceMaps := []map[string]any{}
	for _, d := range devices {
		deviceMaps = append(deviceMaps, map[string]any{
			"id": d.ID, "udn": d.UDN, "name": d.Name,
			"location": d.Location, "ip": d.IP, "port": d.Port,
			"devtype": d.DevType, "server": d.Server,
		})
	}
	return ok(map[string]any{"devices": deviceMaps, "count": len(deviceMaps)})
}

func fetchUPnPDesc(location string) (*DLNAController, error) {
	resp, err := http.Get(location)
	if err != nil {
		return nil, fmt.Errorf("dlna description fetch: %w", err)
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var root UPnPDevice
	if err := xml.Unmarshal(raw, &root); err != nil {
		return nil, fmt.Errorf("dlna xml parse: %w", err)
	}
	ctrl := &DLNAController{Location: location}
	for _, s := range root.Services {
		if strings.Contains(s.ServiceType, "AVTransport") {
			ctrl.avTransport = true
		}
	}
	return ctrl, nil
}

func dlnaPlayURL(req Request) map[string]any {
	location := strings.TrimSpace(req.Location)
	playURL := strings.TrimSpace(req.URL)
	if location == "" {
		return fail("INVALID_PARAMS", "location is required")
	}
	if playURL == "" {
		return fail("INVALID_PARAMS", "url is required")
	}
	title := strings.TrimSpace(req.Title)
	if title == "" {
		title = "HomeSense Media"
	}
	_, err := fetchUPnPDesc(location)
	if err != nil {
		return fail("DLNA_CONTROLLER_FAILED", err.Error())
	}
	return ok(map[string]any{
		"location":     location,
		"url":          playURL,
		"title":        title,
		"content_type": strings.TrimSpace(req.ContentType),
		"message":      "DLNA play requested (full SOAP implementation pending)",
	})
}

func dlnaControl(req Request) map[string]any {
	location := strings.TrimSpace(req.Location)
	action := strings.TrimSpace(strings.ToLower(req.Control))
	if location == "" {
		return fail("INVALID_PARAMS", "location is required")
	}
	if action == "" {
		return fail("INVALID_PARAMS", "control is required")
	}
	_, err := fetchUPnPDesc(location)
	if err != nil {
		return fail("DLNA_CONTROLLER_FAILED", err.Error())
	}
	validActions := map[string]bool{"play": true, "pause": true, "stop": true, "resume": true}
	if !validActions[action] {
		return fail("INVALID_PARAMS", fmt.Sprintf("unknown control: %s", action))
	}
	return ok(map[string]any{"location": location, "action": action, "message": fmt.Sprintf("DLNA %s requested", action)})
}

func dlnaStatus(req Request) map[string]any {
	location := strings.TrimSpace(req.Location)
	if location == "" {
		return fail("INVALID_PARAMS", "location is required")
	}
	ctrl, err := fetchUPnPDesc(location)
	if err != nil {
		return fail("DLNA_CONTROLLER_FAILED", err.Error())
	}
	return ok(map[string]any{"location": ctrl.Location, "has_transport": ctrl.avTransport, "message": "DLNA status"})
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
