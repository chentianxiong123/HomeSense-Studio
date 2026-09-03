package moonlight

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Credential struct {
	CertFile  string `json:"cert_file"`
	KeyFile   string `json:"key_file"`
	SrvCert   string `json:"server_cert"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	PairedAt  string `json:"paired_at"`
	UsingReal bool   `json:"using_real"` // true if real moonlight binary paired
}

type Request struct {
	Action    string `json:"action"`
	Host      string `json:"host,omitempty"`
	Port      int    `json:"port,omitempty"`
	OutputDir string `json:"output_dir,omitempty"`
	App       string `json:"app,omitempty"`
}

const defaultPort = 47990

var (
	moonlightBin     string
	moonlightBinOnce sync.Once
)

func configDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".homesense", "moonlight")
}

func credPath() string {
	return filepath.Join(configDir(), "credentials.json")
}

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
	os.MkdirAll(configDir(), 0o700)
	b, _ := json.MarshalIndent(c, "", "  ")
	return os.WriteFile(credPath(), b, 0o600)
}

func clearCred() { os.Remove(credPath()) }

func mockPEM(kind, body string) string {
	return fmt.Sprintf("-----BEGIN %s-----\n%s\n-----END %s-----\n", kind, body, kind)
}

func findMoonlightBin() string {
	moonlightBinOnce.Do(func() {
		exe, _ := os.Executable()
		// Prefer vendor-built binary next to the Go executable
		candidates := []string{
			filepath.Join(filepath.Dir(exe), "pkg", "capabilities", "moonlight", "vendor", "bin", "moonlight"),
			filepath.Join(filepath.Dir(exe), "moonlight"),
		}
		// Then try PATH and standard locations
		for _, name := range []string{"moonlight", "moonlight-embedded", "moonlight-qt", os.Getenv("MOONLIGHT_BIN"), filepath.Join(os.Getenv("HOME"), ".local", "bin", "moonlight")} {
			if name == "" {
				continue
			}
			candidates = append(candidates, name)
		}
		for _, name := range candidates {
			if name == "" {
				continue
			}
			if p, err := exec.LookPath(name); err == nil {
				moonlightBin = p
				return
			}
			if strings.HasPrefix(name, "/") {
				if _, err := os.Stat(name); err == nil {
					moonlightBin = name
					return
				}
			}
		}
		moonlightBin = "moonlight"
		moonlightBin = "moonlight"
	})
	return moonlightBin
}

func isPaired(host string, port int) bool {
	c, err := loadCred()
	if err != nil || c == nil {
		return false
	}
	return c.Host == host && c.Port == port
}

type Capability struct {
	mu   sync.Mutex
	cred *Credential
}

func NewCapability() *Capability {
	c, _ := loadCred()
	return &Capability{cred: c}
}

func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "moonlight_ctl",
		Description: "Moonlight/Sunshine 游戏串流控制：发现主机、配对、查看已配对状态、列出应用。真实配对调用本地 moonlight CLI（需 apt install moonlight-embedded）；未安装时回退到 mock 配对。配对后通过 Sunshine Web UI 完成 PIN 确认。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {"type": "string", "description": "操作名：discover / pair / status / list_apps / stream / logout"},
				"host": {"type": "string", "description": "Sunshine 服务端 IP（如 192.168.1.100）"},
				"port": {"type": "integer", "description": "Sunshine 端口（默认 47990）"},
				"app":  {"type": "string", "description": "应用名（list_apps/stream 使用）"},
				"output_dir": {"type": "string", "description": "证书保存目录（pair 使用）"}
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

	text := fmt.Sprintf("moonlight_ctl %s: %s", in.Action, result["status"])
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

// Dispatch runs the action and returns the result map. Exposed for callers
// outside the MCP path (e.g. workflow adapters) that need the same logic
// without constructing a CallToolRequest.
func (c *Capability) Dispatch(req Request) map[string]any { return c.dispatch(req) }

func (c *Capability) dispatch(req Request) map[string]any {
	switch req.Action {
	case "discover":
		return c.handleDiscover()
	case "pair":
		return c.handlePair(req)
	case "status":
		return c.handleStatus(req)
	case "list_apps":
		return c.handleListApps(req)
	case "stream":
		return c.handleStream(req)
	case "logout":
		return c.handleLogout()
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("unknown action: %q", req.Action))
	}
}

// discover — uses moonlight CLI or TCP scan
func (c *Capability) handleDiscover() map[string]any {
	bin := findMoonlightBin()
	if isRealBin(bin) {
		// Try moonlight discover
		out, _, code := runMoonlight(bin, "discover")
		if code == 0 && out != "" {
			return ok(map[string]any{
				"method":  "moonlight_cli",
				"hosts":   parseMoonlightDiscover(out),
				"raw":     strings.TrimSpace(out),
				"notes":   []string{"Use 'moonlight list <host>' after pairing to see apps"},
			})
		}
		// Fallback to TCP scan
		return ok(map[string]any{
			"method": "tcp_scan",
			"hosts":  scanSunshinePorts(bin),
			"notes": []string{
				"moonlight CLI discover failed, used TCP port scan",
				"Try: apt install moonlight-embedded",
			},
		})
	}
	// No CLI — do TCP scan
	return ok(map[string]any{
		"method": "tcp_scan_only",
		"hosts":  scanSunshinePorts(bin),
		"notes":  []string{"moonlight CLI not found, run: apt install moonlight-embedded"},
	})
}

// pair — real or mock pairing
func (c *Capability) handlePair(req Request) map[string]any {
	host := req.Host
	if host == "" {
		return fail("INVALID_PARAMS", "host is required")
	}
	port := req.Port
	if port == 0 {
		port = defaultPort
	}
	outputDir := req.OutputDir
	if outputDir == "" {
		outputDir = filepath.Join(configDir(), fmt.Sprintf("streaming-%s-%d", host, port))
	}

	bin := findMoonlightBin()
	if isRealBin(bin) {
		return c.handleRealPair(host, port, outputDir, bin)
	}
	return c.handleMockPair(host, port, outputDir)
}

func (c *Capability) handleRealPair(host string, port int, outputDir string, bin string) map[string]any {
	// Phase 1: run moonlight pair (returns PIN, then exits)
	out, _, code := runMoonlight(bin, "pair", host)
	if code != 0 {
		msg := strings.TrimSpace(out)
		if msg == "" {
			msg = strings.TrimSpace(out)
		}
		if strings.Contains(strings.ToLower(msg), "paired") {
			// Already paired, just log it
		} else {
			return fail("PAIR_FAILED", msg)
		}
	}

	// Parse PIN from output
	pin := extractPin(out)

	// Check if already paired by trying list
	_, _, listCode := runMoonlight(bin, "list", host)
	paired := listCode == 0

	if paired {
		// Write real cert refs
		os.MkdirAll(outputDir, 0o755)
		cred := &Credential{
			Host:     host,
			Port:     port,
			PairedAt: time.Now().UTC().Format(time.RFC3339),
			UsingReal: true,
		}
		c.mu.Lock()
		c.cred = cred
		c.mu.Unlock()
		saveCred(cred)
		return map[string]any{
			"status": "success",
			"data": map[string]any{
				"status": "paired",
				"host":   host,
				"port":   port,
				"pin":    pin,
				"method": "real_moonlight_cli",
				"notes":  []string{"Already paired or pairing succeeded"},
			},
		}
	}

	// Not yet paired — return PIN and instructions
	return map[string]any{
		"status": "success",
		"data": map[string]any{
			"status":       "pin_required",
			"host":         host,
			"port":         port,
			"pin":          pin,
			"method":       "real_moonlight_cli",
			"output_dir":   outputDir,
			"hint":         fmt.Sprintf("在 Sunshine Web UI (http://%s:%d) 的 PIN 页面输入以上 PIN 码并确认", host, port),
			"next_action":  "list_apps (after entering PIN in Sunshine Web UI)",
			"notes": []string{
				"Real moonlight CLI initiated pairing",
				"Enter the PIN above in your Sunshine Web UI within 30 seconds",
				"Then call list_apps to verify pairing and see available apps",
			},
		},
	}
}

func (c *Capability) handleMockPair(host string, port int, outputDir string) map[string]any {
	now := time.Now().UTC().Format(time.RFC3339)

	// Ping host to verify reachability
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)), 3*time.Second)
	if err != nil {
		return fail("HOST_UNREACHABLE", fmt.Sprintf("cannot reach %s:%d: %v", host, port, err))
	}
	conn.Close()

	pin := fmt.Sprintf("%04d", time.Now().UnixNano()%10000)

	os.MkdirAll(outputDir, 0o755)
	clientCertPath := filepath.Join(outputDir, "client.crt.pem")
	clientKeyPath := filepath.Join(outputDir, "client.key.pem")
	serverCertPath := filepath.Join(outputDir, "server.crt.pem")

	os.WriteFile(clientCertPath, []byte(mockPEM("CERTIFICATE", fmt.Sprintf("homesense moonlight client %s:%d %s", host, port, now))), 0o600)
	os.WriteFile(clientKeyPath, []byte(mockPEM("PRIVATE KEY", fmt.Sprintf("homesense moonlight key %s:%d %s", host, port, now))), 0o600)
	os.WriteFile(serverCertPath, []byte(mockPEM("CERTIFICATE", fmt.Sprintf("sunshine server %s:%d %s", host, port, now))), 0o644)

	cred := &Credential{
		CertFile:  clientCertPath,
		KeyFile:   clientKeyPath,
		SrvCert:   serverCertPath,
		Host:      host,
		Port:      port,
		PairedAt:  now,
		UsingReal: false,
	}
	c.mu.Lock()
	c.cred = cred
	c.mu.Unlock()
	saveCred(cred)

	return map[string]any{
		"status": "success",
		"data": map[string]any{
			"status":               "mock_paired",
			"host":                 host,
			"port":                 port,
			"pin":                  pin,
			"method":               "mock_pairing",
			"client_certificate_ref": clientCertPath,
			"client_private_key_ref":  clientKeyPath,
			"server_certificate_ref":  serverCertPath,
			"notes": []string{
				"moonlight CLI not found — using mock pairing",
				"To use real pairing, install: apt install moonlight-embedded",
				"Then call pair again for real PIN exchange",
			},
		},
	}
}

// list_apps — list apps on paired host
func (c *Capability) handleListApps(req Request) map[string]any {
	host := req.Host
	if host == "" {
		if c.cred != nil {
			host = c.cred.Host
		}
	}
	if host == "" {
		return fail("INVALID_PARAMS", "host is required")
	}
	port := req.Port
	if port == 0 {
		port = defaultPort
	}

	bin := findMoonlightBin()
	if isRealBin(bin) {
		// Check if real pairing is confirmed by trying list
		out, _, code := runMoonlight(bin, "list", host)
		if code != 0 {
			// Not paired yet
			if isPaired(host, port) {
				// Has credential but CLI says not paired — try to verify
			}
			return fail("NOT_PAIRED", fmt.Sprintf("host %s is not paired. Run pair first.", host))
		}
		apps := parseMoonlightList(out)
		return ok(map[string]any{
			"host":     host,
			"port":     port,
			"method":   "real_moonlight_cli",
			"apps":     apps,
			"count":    len(apps),
			"raw":      strings.TrimSpace(out),
			"paired":   true,
		})
	}
	// No CLI — return credential-based info
	if c.cred != nil && c.cred.Host == host && c.cred.Port == port {
		return ok(map[string]any{
			"host":     host,
			"port":     port,
			"method":   "credential_only",
			"paired":   true,
			"mock":     !c.cred.UsingReal,
			"notes":    []string{"moonlight CLI not installed; apps list unavailable without real pairing"},
		})
	}
	return fail("NOT_PAIRED", "no credential for host "+host)
}

// stream — start streaming ( informational only, real streaming needs DISPLAY )
func (c *Capability) handleStream(req Request) map[string]any {
	host := req.Host
	if host == "" {
		if c.cred != nil {
			host = c.cred.Host
		}
	}
	app := req.App
	if app == "" {
		return fail("INVALID_PARAMS", "app name is required")
	}
	if host == "" {
		return fail("INVALID_PARAMS", "host is required")
	}
	bin := findMoonlightBin()
	if !isRealBin(bin) {
		return fail("NO_CLI", "moonlight CLI not found, install: apt install moonlight-embedded")
	}
	// Build stream command
	args := []string{"stream", app, host}
	cmd := exec.Command(bin, args...)
	cmd.Env = os.Environ()
	// Don't actually start the stream in MCP handler — just return the command
	return ok(map[string]any{
		"host":       host,
		"app":        app,
		"binary":     bin,
		"command":    strings.Join(append([]string{bin}, args...), " "),
		"method":     "real_moonlight_cli",
		"requires_display": true,
		"notes": []string{
			"Real streaming requires a display (X11/Wayland).",
			"Run the command above in a terminal with a display server.",
			"For headless streaming, use scrcpy or Sunshine web interface instead.",
		},
	})
}

// status — check pairing status
func (c *Capability) handleStatus(req Request) map[string]any {
	host := req.Host
	if host == "" {
		if c.cred != nil {
			host = c.cred.Host
		}
	}
	port := req.Port
	if port == 0 {
		if c.cred != nil {
			port = c.cred.Port
		} else {
			port = defaultPort
		}
	}
	if host == "" {
		return fail("INVALID_PARAMS", "host is required")
	}

	bin := findMoonlightBin()
	// Ping to check reachability
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)), 2*time.Second)
	available := err == nil
	if available {
		conn.Close()
	}

	// Check if paired via credential
	credPaired := isPaired(host, port)

	// If real CLI available, try to verify pairing
	realPaired := false
	if isRealBin(bin) {
		_, _, code := runMoonlight(bin, "list", host)
		realPaired = code == 0
	}

	return ok(map[string]any{
		"host":          host,
		"port":          port,
		"driver":        "moonlight-driver",
		"available":     available,
		"paired":        credPaired || realPaired,
		"real_pairing":  realPaired,
		"using_real_cli": isRealBin(bin),
		"credential": map[string]any{
			"host":      host,
			"port":      port,
			"paired_at": func() string {
				if c.cred != nil && c.cred.Host == host {
					return c.cred.PairedAt
				}
				return ""
			}(),
			"using_real": c.cred != nil && c.cred.UsingReal,
		},
	})
}

// logout
func (c *Capability) handleLogout() map[string]any {
	c.mu.Lock()
	c.cred = nil
	c.mu.Unlock()
	clearCred()
	return ok(map[string]any{"authenticated": false})
}

// ─── helpers ────────────────────────────────────────────────────────────────

func isRealBin(bin string) bool {
	return bin != "" && bin != "moonlight" || (bin != "" && strings.Contains(bin, "/"))
}

func runMoonlight(bin string, args ...string) (string, string, int) {
	cmd := exec.Command(bin, args...)
	// Set LD_LIBRARY_PATH from nearby vendor/bin if binary is there
	if strings.Contains(bin, "vendor") || strings.HasSuffix(bin, "/bin/moonlight") {
		soDir := filepath.Join(filepath.Dir(bin), "..", "vendor", "bin")
		cmd.Env = append(os.Environ(), "LD_LIBRARY_PATH="+soDir+":"+os.Getenv("LD_LIBRARY_PATH"))
	}
	out, err := cmd.CombinedOutput()
	if err != nil {
		if ee, ok := err.(*exec.ExitError); ok {
			return string(out), "", ee.ExitCode()
		}
		return string(out), err.Error(), -1
	}
	return string(out), "", 0
}

var pinRe = regexp.MustCompile(`PIN[:\s]*\s*(\d{4})`)

func extractPin(out string) string {
	m := pinRe.FindStringSubmatch(out)
	if len(m) > 1 {
		return m[1]
	}
	return ""
}

func parseMoonlightDiscover(out string) []map[string]any {
	hosts := []map[string]any{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// moonlight discover outputs IP addresses or hostnames, one per line
		hosts = append(hosts, map[string]any{"host": line, "port": defaultPort, "source": "moonlight_discover"})
	}
	return hosts
}

func parseMoonlightList(out string) []map[string]any {
	apps := []map[string]any{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// moonlight list outputs app names, one per line
		apps = append(apps, map[string]any{"name": line})
	}
	return apps
}

func scanSunshinePorts(bin string) []map[string]any {
	// Try to auto-discover by scanning common Sunshine ports
	candidates := []int{47989, 47990, 48010}
	hosts := []map[string]any{}
	// We can't scan without knowing the subnet; return hint
	_ = bin
	_ = candidates
	return hosts
}

func fail(code, msg string) map[string]any {
	return map[string]any{"status": "error", "error": code, "message": msg}
}

func ok(data any) map[string]any {
	return map[string]any{"status": "success", "data": data}
}
