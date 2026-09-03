package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/sipeed/picoclaw/pkg/capabilities/adb"
	"github.com/sipeed/picoclaw/pkg/capabilities/alist"
	"github.com/sipeed/picoclaw/pkg/capabilities/a11y"
	"github.com/sipeed/picoclaw/pkg/capabilities/bilibili"
	"github.com/sipeed/picoclaw/pkg/capabilities/dlna"
	"github.com/sipeed/picoclaw/pkg/capabilities/media"
	"github.com/sipeed/picoclaw/pkg/capabilities/mi"
	"github.com/sipeed/picoclaw/pkg/capabilities/moonlight"
	"github.com/sipeed/picoclaw/pkg/capabilities/remote_desktop"
	"github.com/sipeed/picoclaw/pkg/ruleengine"
	"github.com/sipeed/picoclaw/pkg/workflowmatch"
)

var server = mcp.NewServer(&mcp.Implementation{
	Name:    "homesense-executor",
	Version: "v0.1.0",
}, nil)

var (
	ruleEngine      *ruleengine.Engine
	workflowMatcher *workflowmatch.Matcher
	workflowStore   *workflowmatch.Store
	embedder        *workflowmatch.Embedder
)

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

func getInfo(ctx context.Context, req *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, ExecutorInfo, error) {
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

// initWorkflowMatch initializes the L2 workflow matcher (embedding + fingerprint).
func initWorkflowMatch(workspaceDir string) error {
	// Load embedder
	embedCfg := workflowmatch.DefaultEmbedderConfig()
	embedCfg.LibPath = filepath.Join(workspaceDir, "libonnxruntime.so")
	emb, err := workflowmatch.NewEmbedder(embedCfg)
	if err != nil {
		return fmt.Errorf("init embedder: %w", err)
	}
	embedder = emb

	// Create store and load workflows
	storeCfg := workflowmatch.DefaultStoreConfig(workspaceDir)
	store, err := workflowmatch.NewStore(storeCfg)
	if err != nil {
		emb.Close()
		return fmt.Errorf("create store: %w", err)
	}

	workflowsDir := filepath.Join(workspaceDir, "workflows")
	if err := store.LoadWorkflows(workflowsDir, func(text string) ([]float32, error) {
		return embedder.Encode(context.Background(), text)
	}); err != nil {
		emb.Close()
		return fmt.Errorf("load workflows: %w", err)
	}

	workflowStore = store
	workflowMatcher = workflowmatch.NewMatcher(store, emb, nil)
	return nil
}

func registerTools() {
	// L1: rule_engine
	mcp.AddTool(server, &mcp.Tool{
		Name:        "rule_engine",
		Description: "规则引擎。输入用户指令，返回匹配的设备和操作参数。用于简单设备控制场景（开/关灯、空调、电视等），跳过 LLM 推理。",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"input": map[string]any{"type": "string", "description": "用户原始指令文本"},
			},
			"required": []string{"input"},
		},
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
		var args struct{ Input string }
		if len(req.Params.Arguments) > 0 {
			_ = json.Unmarshal(req.Params.Arguments, &args)
		}
		result := ruleEngine.Match(args.Input)
		data, _ := json.Marshal(result)
		return &mcp.CallToolResult{
			Content:         []mcp.Content{&mcp.TextContent{Text: string(data)}},
			StructuredContent: result,
		}, nil, nil
	})

	// L2: workflow_match
	mcp.AddTool(server, &mcp.Tool{
		Name:        "workflow_match",
		Description: "意图-工作流匹配。混合检索：fingerprint 精确 → BM25 词面 → embedding 语义，RRF 融合 + 意图卡片(negative)反例否决。返回匹配的 workflow chain_id 和 confidence。",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"input":     map[string]any{"type": "string", "description": "用户原始输入文本"},
				"threshold": map[string]any{"type": "number", "default": 0.65, "description": "最小置信度阈值"},
			},
			"required": []string{"input"},
		},
	}, func(ctx context.Context, req *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
		var args struct {
			Input     string  `json:"input"`
			Threshold float32 `json:"threshold"`
		}
		if len(req.Params.Arguments) > 0 {
			_ = json.Unmarshal(req.Params.Arguments, &args)
		}
		if args.Threshold == 0 {
			args.Threshold = 0.65
		}
		matcher := workflowmatch.NewMatcher(workflowStore, embedder, &workflowmatch.MatcherConfig{Threshold: args.Threshold})
		result, err := matcher.Match(ctx, args.Input)
		if err != nil {
			return &mcp.CallToolResult{
				Content: []mcp.Content{&mcp.TextContent{Text: fmt.Sprintf(`{"error":"%v"}`, err)}},
			}, nil, nil
		}
		if result == nil {
			result = &workflowmatch.MatchResult{ChainID: "", Confidence: 0, Method: "none"}
		}
		data, _ := json.Marshal(result)
		return &mcp.CallToolResult{
			Content:         []mcp.Content{&mcp.TextContent{Text: string(data)}},
			StructuredContent: result,
		}, nil, nil
	})

	// executor_info
	mcp.AddTool(server, &mcp.Tool{
		Name:        "executor_info",
		Description: "返回执行端自身信息（宿主名/系统/能力清单/运行时长）。只读、无任何命令执行能力。",
	}, getInfo)

	// 原有 capability 工具
	miCap := mi.NewCapability()
	mcp.AddTool(server, miCap.MCPTool(), miCap.Handler)

	alistCap := alist.NewCapability()
	mcp.AddTool(server, alistCap.MCPTool(), alistCap.Handler)

	adbCap := adb.NewCapability()
	mcp.AddTool(server, adbCap.MCPTool(), adbCap.Handler)

	a11yCap := a11y.NewCapability()
	mcp.AddTool(server, a11yCap.MCPTool(), a11yCap.Handler)

	mediaCap := media.NewCapability()
	mcp.AddTool(server, mediaCap.MCPTool(), mediaCap.Handler)

	biliCap := bilibili.NewCapability()
	mcp.AddTool(server, biliCap.MCPTool(), biliCap.Handler)

	dlnaCap := dlna.NewCapability()
	mcp.AddTool(server, dlnaCap.MCPTool(), dlnaCap.Handler)

	moonlightCap := moonlight.NewCapability()
	mcp.AddTool(server, moonlightCap.MCPTool(), moonlightCap.Handler)

	rdCap := remote_desktop.NewCapability()
	mcp.AddTool(server, rdCap.MCPTool(), rdCap.Handler)
}

func registeredToolNames() []string {
	return []string{
		"executor_info", "mi_device", "netdisk_sync", "adb_cmd",
		"a11y_ctl", "moonlight_ctl", "remote_desktop", "bilibili_ctl",
		"dlna_ctl", "media_sniff", "rule_engine", "workflow_match",
	}
}
