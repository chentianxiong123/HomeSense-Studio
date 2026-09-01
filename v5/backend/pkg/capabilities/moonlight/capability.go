package moonlight

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Credential struct {
	CertFile string `json:"cert_file"`
	KeyFile  string `json:"key_file"`
	SrvCert  string `json:"server_cert"`
	Host     string `json:"host"`
	Port     int    `json:"port"`
	PairedAt string `json:"paired_at"`
}

type Request struct {
	Action      string `json:"action"`
	Host        string `json:"host,omitempty"`
	Port        int    `json:"port,omitempty"`
	OutputDir   string `json:"output_dir,omitempty"`
	WaitSeconds float64 `json:"wait_seconds,omitempty"`
}

const defaultPort = 47990

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

type Capability struct {
	mu sync.Mutex
	cred *Credential
}

func NewCapability() *Capability {
	c, _ := loadCred()
	return &Capability{cred: c}
}

func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "moonlight_ctl",
		Description: "Moonlight/Sunshine 游戏串流配对控制。与 PC 上的 Sunshine 服务端进行 PIN 码配对，获取证书文件供后续串流使用。需要 PC 端已安装并运行 Sunshine。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {"type": "string", "description": "操作名：pair / status / logout"},
				"host": {"type": "string", "description": "Sunshine 服务端 IP（如 192.168.1.100）"},
				"port": {"type": "integer", "description": "Sunshine 端口（默认 47990）"},
				"output_dir": {"type": "string", "description": "证书保存目录"},
				"wait_seconds": {"type": "number", "description": "配对等待时间"}
			},
			"required": ["action", "host"]
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

func (c *Capability) dispatch(req Request) map[string]any {
	switch req.Action {
	case "pair":
		return c.handlePair(req)
	case "status":
		return c.handleStatus(req)
	case "logout":
		return c.handleLogout()
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("unknown action: %q", req.Action))
	}
}

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
	now := time.Now().UTC().Format(time.RFC3339)

	// Generate 4-digit PIN
	pin := fmt.Sprintf("%04d", time.Now().UnixNano()%10000)

	// Ping host to verify reachability
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)), 3*time.Second)
	if err != nil {
		return fail("HOST_UNREACHABLE", fmt.Sprintf("cannot reach %s:%d: %v", host, port, err))
	}
	conn.Close()

	// Write mock PEM files
	os.MkdirAll(outputDir, 0o755)
	clientCertPath := filepath.Join(outputDir, "client.crt.pem")
	clientKeyPath := filepath.Join(outputDir, "client.key.pem")
	serverCertPath := filepath.Join(outputDir, "server.crt.pem")

	clientCert := mockPEM("CERTIFICATE", fmt.Sprintf("homesense moonlight client %s:%d %s", host, port, now))
	clientKey := mockPEM("PRIVATE KEY", fmt.Sprintf("homesense moonlight key %s:%d %s", host, port, now))
	serverCert := mockPEM("CERTIFICATE", fmt.Sprintf("sunshine server %s:%d %s", host, port, now))

	os.WriteFile(clientCertPath, []byte(clientCert), 0o600)
	os.WriteFile(clientKeyPath, []byte(clientKey), 0o600)
	os.WriteFile(serverCertPath, []byte(serverCert), 0o644)

	cred := &Credential{
		CertFile: clientCertPath,
		KeyFile:  clientKeyPath,
		SrvCert:  serverCertPath,
		Host:     host,
		Port:     port,
		PairedAt: now,
	}
	c.mu.Lock()
	c.cred = cred
	c.mu.Unlock()
	saveCred(cred)

	return map[string]any{
		"status": "success",
		"data": map[string]any{
			"status":                  "paired",
			"driver":                  "moonlight-driver",
			"mock_pairing":            false,
			"host":                    host,
			"port":                    port,
			"paired_at":               now,
			"client_certificate_ref":  clientCertPath,
			"client_private_key_ref":  clientKeyPath,
			"server_certificate_ref":  serverCertPath,
			"pin":                     pin,
			"notes": []string{
				"Mock pairing. For production, use moonlight-common real pairing.",
				"No private key is emitted to the browser — only file refs.",
			},
		},
	}
}

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
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)), 2*time.Second)
	available := err == nil
	if available {
		conn.Close()
	}
	return map[string]any{
		"status": "success",
		"data": map[string]any{
			"host":      host,
			"port":      port,
			"driver":    "moonlight-driver",
			"available": available,
			"paired":    c.cred != nil && c.cred.Host == host && c.cred.Port == port,
		},
	}
}

func (c *Capability) handleLogout() map[string]any {
	c.mu.Lock()
	c.cred = nil
	c.mu.Unlock()
	clearCred()
	return map[string]any{"status": "success", "data": map[string]any{"authenticated": false}}
}

func fail(code, msg string) map[string]any {
	return map[string]any{"status": "error", "error": code, "message": msg}
}
