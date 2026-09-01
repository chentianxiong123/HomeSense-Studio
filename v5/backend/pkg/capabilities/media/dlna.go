package media

import (
	"encoding/xml"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

type DLNADevice struct {
	ID       string `json:"id"`
	UDN      string `json:"udn"`
	Name     string `json:"name"`
	Location string `json:"location"`
	IP       string `json:"ip"`
	Port     int    `json:"port"`
	DevType  string `json:"device_type"`
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

func ssdpSearch(timeoutSec int, targetIP string) ([]DLNADevice, error) {
	conn, err := net.ListenUDP("udp4", nil)
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	msearch := `M-SEARCH * HTTP/1.1
HOST: 239.255.255.250:1900
MAN: "ssdp:disrupt"
MX: 3
ST: upnp:rootdevice
`
	if targetIP != "" {
		msearch = fmt.Sprintf("HOST: %s:1900\nMX: 3\nST: upnp:rootdevice\n\n", targetIP)
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
			"id":       d.ID,
			"udn":      d.UDN,
			"name":     d.Name,
			"location": d.Location,
			"ip":       d.IP,
			"port":     d.Port,
			"devtype":  d.DevType,
			"server":   d.Server,
		})
	}
	return ok(map[string]any{"devices": deviceMaps, "count": len(deviceMaps)})
}

func enrichDevice(location string) *DLNADevice {
	resp, err := http.Get(location)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()
	raw, _ := io.ReadAll(resp.Body)
	var root UPnPDevice
	if err := xml.Unmarshal(raw, &root); err != nil {
		return nil
	}
	return &DLNADevice{
		Name:     root.FriendlyName,
		Location: location,
	}
}

type DLNAController struct {
	Location    string
	avTransport string
}

func _createController(location string) (*DLNAController, error) {
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
			ctrl.avTransport = location
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
	_, err := _createController(location)
	if err != nil {
		return fail("DLNA_CONTROLLER_FAILED", err.Error())
	}
	return ok(map[string]any{
		"location":      location,
		"url":           playURL,
		"title":         title,
		"content_type":  strings.TrimSpace(req.ContentType),
		"message":       "DLNA play requested (full SOAP implementation pending)",
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
	_, err := _createController(location)
	if err != nil {
		return fail("DLNA_CONTROLLER_FAILED", err.Error())
	}
	validActions := map[string]bool{"play": true, "pause": true, "stop": true, "resume": true}
	if !validActions[action] {
		return fail("INVALID_PARAMS", fmt.Sprintf("unknown control: %s", action))
	}
	return ok(map[string]any{
		"location": location,
		"action":   action,
		"message":  fmt.Sprintf("DLNA %s requested", action),
	})
}

func dlnaStatus(req Request) map[string]any {
	location := strings.TrimSpace(req.Location)
	if location == "" {
		return fail("INVALID_PARAMS", "location is required")
	}
	ctrl, err := _createController(location)
	if err != nil {
		return fail("DLNA_CONTROLLER_FAILED", err.Error())
	}
	return ok(map[string]any{
		"location":        ctrl.Location,
		"has_transport":   ctrl.avTransport != "",
		"message":         "DLNA status",
	})
}

// --- resource search ---

func resourceSearch(req Request) map[string]any {
	query := strings.TrimSpace(req.Query)
	if query == "" {
		return fail("INVALID_PARAMS", "query is required")
	}
	limit := clampInt(req.Limit, 1, 100)
	if req.Limit == 0 {
		limit = 20
	}
	return ok(map[string]any{
		"query":     query,
		"count":     0,
		"hits":      []map[string]any{},
		"sources":   len(req.Sources),
		"providers": []string{"bilibili", "dlna", "resources"},
		"limit":     limit,
	})
}

func resourceNormalize(req Request) map[string]any {
	query := strings.TrimSpace(req.Query)
	hit := strings.TrimSpace(req.Hit)
	if query == "" || hit == "" {
		return fail("INVALID_PARAMS", "query and hit are required")
	}
	return ok(map[string]any{
		"query":      query,
		"hit":        hit,
		"normalized": strings.ToLower(hit),
	})
}

// --- sniff ---

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
		candidates = append(candidates, map[string]any{
			"url":        u,
			"mime_type":  mt,
			"confidence": 0.95,
		})
	}
	if len(candidates) == 0 {
		candidates = append(candidates, map[string]any{
			"url":        u,
			"mime_type":  "application/octet-stream",
			"confidence": 0.5,
		})
	}
	if len(candidates) > maxCandidates {
		candidates = candidates[:maxCandidates]
	}
	return ok(map[string]any{
		"url":        u,
		"count":      len(candidates),
		"strategy":   "direct-or-page",
		"candidates": candidates,
	})
}
