package main

import (
	"context"
	"os"
	"runtime"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/sipeed/picoclaw/pkg/capabilities/adb"
	"github.com/sipeed/picoclaw/pkg/capabilities/alist"
	"github.com/sipeed/picoclaw/pkg/capabilities/media"
	"github.com/sipeed/picoclaw/pkg/capabilities/mi"
	"github.com/sipeed/picoclaw/pkg/capabilities/moonlight"
	"github.com/sipeed/picoclaw/pkg/capabilities/remote_desktop"
)

var server = mcp.NewServer(&mcp.Implementation{
	Name:    "homesense-executor",
	Version: "v0.1.0",
}, nil)

type ExecutorInfo struct {
	Hostname   string            `json:"hostname"`
	Pid        int               `json:"pid"`
	GoVersion  string            `json:"goVersion"`
	OS         string            `json:"os"`
	Arch       string            `json:"arch"`
	StartedAt  string            `json:"startedAt"`
	Uptime     string            `json:"uptime"`
	Executable string            `json:"executable"`
	Cwd        string            `json:"cwd"`
	Env        map[string]string `json:"env,omitempty"`
	Capabilies []string          `json:"capabilities"`
}

var startedAt = time.Now()

func currentExecutorInfo() ExecutorInfo {
	exe, _ := os.Executable()
	cwd, _ := os.Getwd()
	hostname, _ := os.Hostname()
	return ExecutorInfo{
		Hostname:   hostname,
		Pid:        os.Getpid(),
		GoVersion:  runtime.Version(),
		OS:         runtime.GOOS,
		Arch:       runtime.GOARCH,
		StartedAt:  startedAt.Format(time.RFC3339),
		Uptime:     time.Since(startedAt).Round(time.Second).String(),
		Executable: exe,
		Cwd:        cwd,
		Capabilies: registeredToolNames(),
	}
}

func getInfo(ctx context.Context, _ *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, ExecutorInfo, error) {
	info := currentExecutorInfo()
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: "executor info: " + info.OS + "/" + info.Arch + " pid=" + itoa(info.Pid)},
		},
		StructuredContent: info,
	}, info, nil
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	var b [20]byte
	i := len(b)
	for n > 0 {
		i--
		b[i] = byte('0' + n%10)
		n /= 10
	}
	return string(b[i:])
}

func registerTools() {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "executor_info",
		Description: "返回执行端自身信息（宿主名/系统/能力清单/运行时长）。只读、无任何命令执行能力。",
	}, getInfo)

	miCap := mi.NewCapability()
	mcp.AddTool(server, miCap.MCPTool(), miCap.Handler)

	alistCap := alist.NewCapability()
	mcp.AddTool(server, alistCap.MCPTool(), alistCap.Handler)

	adbCap := adb.NewCapability()
	mcp.AddTool(server, adbCap.MCPTool(), adbCap.Handler)

	mediaCap := media.NewCapability()
	mcp.AddTool(server, mediaCap.MCPTool(), mediaCap.Handler)

	moonlightCap := moonlight.NewCapability()
	mcp.AddTool(server, moonlightCap.MCPTool(), moonlightCap.Handler)

	rdCap := remote_desktop.NewCapability()
	mcp.AddTool(server, rdCap.MCPTool(), rdCap.Handler)
}

func registeredToolNames() []string {
	names := []string{"executor_info", "mi_device", "netdisk_sync", "adb_cmd", "media_ctl", "moonlight_ctl", "remote_desktop"}
	return names
}