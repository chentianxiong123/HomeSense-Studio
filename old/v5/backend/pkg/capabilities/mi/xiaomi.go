package mi

import (
	"bytes"
	"crypto/rand"
	"crypto/rc4"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"time"
)

const (
	AccountBase = "https://account.xiaomi.com"
	ServiceLoginURL  = AccountBase + "/pass/serviceLogin"
	SignURL          = AccountBase + "/pass/serviceLoginAuth2"
	APIBaseURL       = "https://api.io.mi.com/app"
	MiSID            = "xiaomiio"
	UserAgentTmpl    = "Android-7.1.1-1.0.0-ONEPLUS A3010-136-%s APP/xiaomi.smarthome APPV/62830"
)

var httpClient = &http.Client{Timeout: 30 * time.Second}

// ---------------------------------------------------------------------------
// Crypto primitives (mirrors crypto.py)
// ---------------------------------------------------------------------------

func genNonce() string {
	var b [16]byte
	rand.Read(b[:])
	// Use lower 63 bits as nonce value
	b[0] &= 0x3F
	n := binary.BigEndian.Uint64(b[:])
	// Encode as variable-length big-endian bytes
	var buf bytes.Buffer
	binary.Write(&buf, binary.BigEndian, n)
	padBytes := buf.Bytes()
	millis := time.Now().UnixMilli()
	part2 := millis / 60000
	pad := make([]byte, (uint(part2)*8+7)/8)
	for i := range pad {
		pad[i] = byte(part2 >> uint((len(pad)-1-i)*8))
	}
	out := append(padBytes, pad...)
	return base64.StdEncoding.EncodeToString(out)
}

func signedNonce(ssecurity, nonce string) string {
	m := sha256.New()
	d1, _ := base64.StdEncoding.DecodeString(ssecurity)
	d2, _ := base64.StdEncoding.DecodeString(nonce)
	m.Write(d1)
	m.Write(d2)
	return base64.StdEncoding.EncodeToString(m.Sum(nil))
}

func sha1Sign(method, uri string, params map[string]string, snonce string) string {
	parts := []string{method, uri}
	for k, v := range params {
		parts = append(parts, k+"="+v)
	}
	parts = append(parts, snonce)
	h := sha1.New()
	h.Write([]byte(strings.Join(parts, "&")))
	return base64.StdEncoding.EncodeToString(h.Sum(nil))
}

func encryptRC4(keyB64, plaintext string) string {
	key, _ := base64.StdEncoding.DecodeString(keyB64)
	c, _ := rc4.NewCipher(key)
	buf := make([]byte, 1024)
	c.XORKeyStream(buf, buf) // drain
	out := make([]byte, len(plaintext))
	c.XORKeyStream(out, []byte(plaintext))
	return base64.StdEncoding.EncodeToString(out)
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

func apiCookies(a *AuthState) map[string]string {
	return map[string]string{
		"userId":    a.UserID,
		"serviceToken": a.ServiceToken,
		"locale":    "zh_CN",
		"channel":   "MI_APP_STORE",
	}
}

func apiHeaders(a *AuthState) map[string]string {
	return map[string]string{
		"X-XIAOMI-PROTOCAL-FLAG-CLI": "PROTOCAL-HTTP2",
		"Content-Type":               "application/x-www-form-urlencoded",
		"User-Agent":                 fmt.Sprintf(UserAgentTmpl, a.DeviceID),
		"Accept-Encoding":            "identity",
		"MIOT-ENCRYPT-ALGORITHM":     "ENCRYPT-RC4",
	}
}

// requestAPI sends a signed, RC4-encrypted Mi Home API call.
func requestAPI(a *AuthState, uri string, data map[string]any) (any, error) {
	// Refresh serviceToken if stale
	if !isTokenValid(a) {
		if err := refreshServiceToken(a); err != nil {
			return nil, fmt.Errorf("token refresh failed: %w", err)
		}
	}

	nonce := genNonce()
	snonce := signedNonce(a.Security, nonce)

	jsonData, _ := json.Marshal(data)
	params := map[string]string{
		"data": string(jsonData),
	}
	// rc4_hash__ computed on unencrypted params
	params["rc4_hash__"] = sha1Sign("POST", uri, params, snonce)
	// Encrypt all params
	for k := range params {
		params[k] = encryptRC4(snonce, params[k])
	}
	// signature on encrypted params
	params["signature"] = sha1Sign("POST", uri, params, snonce)
	params["ssecurity"] = encryptRC4(snonce, a.Security)
	params["_nonce"] = encryptRC4(snonce, nonce)

	url := APIBaseURL + uri
	req, _ := http.NewRequest("POST", url, strings.NewReader(formEncode(params)))
	for k, v := range apiHeaders(a) {
		req.Header.Set(k, v)
	}
	for k, v := range apiCookies(a) {
		req.AddCookie(&http.Cookie{Name: k, Value: v})
	}
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("network: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)

	var ret struct {
		Code    int         `json:"code"`
		Message string      `json:"message"`
		Result  any         `json:"result"`
	}
	if err := json.Unmarshal(body, &ret); err != nil {
		return nil, fmt.Errorf("bad response: %s", string(body[:min(len(body), 200)]))
	}
	if ret.Code != 0 {
		return nil, fmt.Errorf("api error code=%d msg=%s", ret.Code, ret.Message)
	}
	return ret.Result, nil
}

func formEncode(m map[string]string) string {
	var b strings.Builder
	first := true
	for k, v := range m {
		if !first {
			b.WriteByte('&')
		}
		b.WriteString(k)
		b.WriteByte('=')
		b.WriteString(v)
		first = false
	}
	return b.String()
}

// ---------------------------------------------------------------------------
// Auth flows
// ---------------------------------------------------------------------------

func refreshServiceToken(a *AuthState) error {
	session := &http.Client{Timeout: 30 * time.Second}
	session.Jar, _ = cookiejar.New(nil)

	// Step 1: get login params
	resp, err := session.Get(ServiceLoginURL + "?sid=" + MiSID + "&_json=true")
	if err != nil {
		return err
	}
	var loginInfo map[string]any
	json.NewDecoder(resp.Body).Decode(&loginInfo)
	resp.Body.Close()

	location, _ := loginInfo["location"].(string)
	if location == "" {
		return fmt.Errorf("no location in login response")
	}

	resp2, err := session.Get(location)
	if err != nil {
		return err
	}
	defer resp2.Body.Close()
	cookies := resp2.Cookies()
	tokenFound := false
	for _, c := range cookies {
		if c.Name == "serviceToken" {
			a.ServiceToken = c.Value
			tokenFound = true
		}
		if c.Name == "userId" {
			a.UserID = c.Value
		}
		if c.Name == "cUserId" {
			a.CUserID = c.Value
		}
		if c.Name == "ssecurity" {
			a.Security = c.Value
		}
		if c.Name == "passToken" {
			a.PassToken = c.Value
		}
	}
	if tokenFound {
		a.ExpireTime = time.Now().Add(30 * 24 * time.Hour).UnixMilli()
		return writeAuth(a)
	}
	return fmt.Errorf("serviceToken not found")
}

func loginQR(a *AuthState) (qrURL string, pollURL string, err error) {
	// Simplified QR: use the miio app QR endpoint
	// Real implementation calls the QR generate API; we return a placeholder URL
	// that users scan with the Mi Home app.
	qrURL = "https://account.xiaomi.com/pass/qrcode/generate?sid=" + MiSID
	pollURL = "https://account.xiaomi.com/pass/qrcode/poll"
	return
}

func pollQRStatus(pollURL string, a *AuthState) (logged bool, err error) {
	// Poll the QR login endpoint until the Mi Home app confirms scan
	// This is a simplified implementation; real flow requires callback URL monitoring.
	return false, fmt.Errorf("QR polling not yet implemented in Go port")
}

// ---------------------------------------------------------------------------
// Device discovery
// ---------------------------------------------------------------------------

func discoverHomes(a *AuthState) ([]map[string]any, error) {
	result, err := requestAPI(a, "/v2/homeroom/gethome_merged", map[string]any{
		"fg":            true,
		"fetch_share":   true,
		"fetch_share_dev": true,
		"fetch_cariot":  true,
		"limit":         50,
		"app_ver":       float64(7),
		"plat_form":     float64(0),
	})
	if err != nil {
		return nil, err
	}
	raw, _ := result.(map[string]any)
	homes, _ := raw["homelist"].([]any)
	if homes == nil {
		homes, _ = raw["home_list"].([]any)
	}
	out := make([]map[string]any, 0, len(homes))
	for _, h := range homes {
		m, _ := h.(map[string]any)
		out = append(out, m)
	}
	return out, nil
}

func discoverDevices(a *AuthState, homeID any) ([]map[string]any, error) {
	result, err := requestAPI(a, "/home/home_device_list", map[string]any{
		"home_owner":        float64(1),
		"home_id":           homeID,
		"limit":             float64(200),
		"get_split_device":  true,
		"support_smart_home": true,
		"get_cariot_device": true,
		"get_third_device":  true,
	})
	if err != nil {
		return nil, err
	}
	raw, _ := result.(map[string]any)
	devs, _ := raw["device_info"].([]any)
	if devs == nil {
		devs, _ = raw["devices"].([]any)
	}
	out := make([]map[string]any, 0, len(devs))
	for _, d := range devs {
		m, _ := d.(map[string]any)
		out = append(out, m)
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// Capability profile helpers (mirrors capability/engine.py)
// ---------------------------------------------------------------------------

// buildCapabilityProfile maps known capability names → siid/piid/aiid for a device.
func buildCapabilityProfile(dev map[string]any) map[string]map[string]any {
	// For now we return the raw device data; real profiles come from spec parsing.
	// This is a placeholder that the LLM can work with.
	return map[string]map[string]any{}
}

// ---------------------------------------------------------------------------
// Device search helpers
// ---------------------------------------------------------------------------

func findDevice(devices []Device, did string, name string) (*Device, error) {
	if did != "" {
		for i := range devices {
			if devices[i].DID == did {
				return &devices[i], nil
			}
		}
		return nil, fmt.Errorf("device not found: %s", did)
	}
	if name != "" {
		found := make([]Device, 0)
		nameLower := strings.ToLower(name)
		for i := range devices {
			dn := strings.ToLower(devices[i].Name)
			if strings.Contains(dn, nameLower) || strings.Contains(nameLower, dn) {
				found = append(found, devices[i])
			}
		}
		if len(found) == 0 {
			return nil, fmt.Errorf("device not found: %s", name)
		}
		if len(found) > 1 {
			return nil, fmt.Errorf("ambiguous match for '%s': %d devices", name, len(found))
		}
		return &found[0], nil
	}
	return nil, fmt.Errorf("must specify did or name")
}
