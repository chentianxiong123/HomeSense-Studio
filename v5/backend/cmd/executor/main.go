package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/sipeed/picoclaw/pkg/config"
	"github.com/sipeed/picoclaw/pkg/ruleengine"
)

var (
	host = flag.String("host", "127.0.0.1", "host to listen on")
	port = flag.Int("port", 51122, "port to listen on")
)

func main() {
	flag.Usage = func() {
		fmt.Fprintf(os.Stderr, "Usage: %s [options]\n\n", os.Args[0])
		fmt.Fprintf(os.Stderr, "HomeSense v5 执行端虚拟 MCP server，跑在 termux/盒子，承接云端沙箱下发的命令本地执行。\n\nOptions:\n")
		flag.PrintDefaults()
		fmt.Fprintf(os.Stderr, "\nEndpoints:\n  /executor - MCP SSE endpoint\n")
		os.Exit(1)
	}
	flag.Parse()

	// 获取 workspace 路径
	homeDir := config.GetHome()
	workspaceDir := filepath.Join(homeDir, "workspace")

	// 初始化 L1 规则引擎
	ruleEngine = ruleengine.NewEngine()

	// 初始化 L2 embedding + 工作流匹配
	if err := initWorkflowMatch(workspaceDir); err != nil {
		log.Printf("Warning: L2 workflow match init failed: %v (将继续运行，仅 L1 规则匹配可用)", err)
	}

	registerTools()

	addr := fmt.Sprintf("%s:%d", *host, *port)
	handler := mcp.NewSSEHandler(func(request *http.Request) *mcp.Server {
		return server
	}, nil)

	log.Printf("executor MCP server serving at http://%s/executor (pid=%d)", addr, os.Getpid())
	srv := &http.Server{
		Addr:              addr,
		Handler:           handler,
		ReadHeaderTimeout: 10 * time.Second,
	}
	if err := srv.ListenAndServe(); err != nil {
		log.Fatal(err)
	}
}
