package mi

import (
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

// AuthState is the persisted login credential for Xiaomi Mi Home.
type AuthState struct {
	UserID          string    `json:"userId"`
	CUserID         string    `json:"cUserId"`
	Security        string    `json:"ssecurity"`
	ServiceToken    string    `json:"serviceToken"`
	PassToken       string    `json:"passToken"`
	DeviceID        string    `json:"deviceId"`
	UserAgent       string    `json:"ua"`
	ExpireTime      int64     `json:"expireTime"` // ms since epoch
	minaServiceToken string   `json:"-"`
}

// Device represents a discovered Mi home device.
type Device struct {
	DID         string `json:"did"`
	Name        string `json:"name"`
	Model       string `json:"model"`
	Manufacturer string `json:"manufacturer"`
	ConnType    string `json:"connection_type"`
	RoomName    string `json:"room_name"`
	HomeName    string `json:"home_name"`
	HomeID      int    `json:"home_id"`
	DeviceType  string `json:"device_type"`
	Controls    map[string]DeviceControl `json:"controls"`
}

type DeviceControl struct {
	SiID int    `json:"siid"`
	PiID int    `json:"piid,omitempty"`
	AiID int    `json:"aiid,omitempty"`
	Type string `json:"type"` // "property" or "action"
}

// DiscoverSummary is the compact form returned to the LLM.
type DiscoverSummary struct {
	DID         string   `json:"did"`
	Name        string   `json:"name"`
	Model       string   `json:"model"`
	Room        string   `json:"room"`
	DeviceType  string   `json:"device_type"`
	Actions     []string `json:"actions"`
	Properties  []string `json:"properties"`
}

// CapabilityRequest is the JSON body for any mi_device MCP tool call.
type CapabilityRequest struct {
	Action      string `json:"action"`
	DID         string `json:"did,omitempty"`
	Name        string `json:"name,omitempty"`
	Capability  string `json:"capability,omitempty"`
	SiID        int    `json:"siid,omitempty"`
	PiID        int    `json:"piid,omitempty"`
	AiID        int    `json:"aiid,omitempty"`
	Value       any    `json:"value,omitempty"`
	Params      []any  `json:"params,omitempty"`
	ParentDID   string `json:"parent_did,omitempty"`
	ControllerID string `json:"controller_id,omitempty"`
	KeyID       string `json:"key_id,omitempty"`
	Renew       bool   `json:"renew,omitempty"`
	SummaryOnly bool   `json:"summary_only,omitempty"`
	Text        string `json:"text,omitempty"`
	Ticket      string `json:"ticket,omitempty"`
	URL         string `json:"url,omitempty"`
	Volume      int    `json:"volume,omitempty"`
	Silent      bool   `json:"silent,omitempty"`
	Control     string `json:"control,omitempty"`
}

func (r CapabilityRequest) JSON() string { b, _ := json.Marshal(r); return string(b) }

// authDir returns the ~/.homesense/mi/ directory.
func authDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".homesense", "mi")
}

func authFile() string { return filepath.Join(authDir(), "auth.json") }
func deviceCacheFile() string { return filepath.Join(authDir(), "device_cache.json") }

func writeAuth(a *AuthState) error {
	os.MkdirAll(authDir(), 0o700)
	b, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(authFile(), b, 0o600)
}

func readAuth() (*AuthState, error) {
	b, err := os.ReadFile(authFile())
	if err != nil {
		return nil, err
	}
	var a AuthState
	if err := json.Unmarshal(b, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

func isTokenValid(a *AuthState) bool {
	if a == nil {
		return false
	}
	needed := a.UserID != "" && a.Security != "" && a.ServiceToken != "" && a.CUserID != ""
	if !needed {
		return false
	}
	if a.ExpireTime == 0 {
		return true // legacy, no expiry
	}
	return time.Now().UnixMilli() < a.ExpireTime
}

func writeDeviceCache(devices []Device) error {
	os.MkdirAll(authDir(), 0o700)
	b, err := json.MarshalIndent(map[string]any{
		"updated_at": time.Now().UnixMilli(),
		"devices":    devices,
	}, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(deviceCacheFile(), b, 0o600)
}

func readDeviceCache() ([]Device, error) {
	b, err := os.ReadFile(deviceCacheFile())
	if err != nil {
		return nil, err
	}
	var raw struct {
		Devices []Device `json:"devices"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return nil, err
	}
	return raw.Devices, nil
}
