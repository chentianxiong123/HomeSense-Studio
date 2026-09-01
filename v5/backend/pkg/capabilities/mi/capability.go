package mi

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// Capability is the mi_device capability registered as a single MCP tool.
type Capability struct {
	mu     sync.Mutex
	auth   *AuthState
}

// NewCapability creates a new mi_device capability with its own auth state.
func NewCapability() *Capability {
	a, err := readAuth()
	if err != nil || !isTokenValid(a) {
		a = &AuthState{}
	}
	return &Capability{auth: a}
}

// MCPTool returns the MCP Tool definition for mi_device.
func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "mi_device",
		Description: "小米米家设备控制：登录、发现设备、执行动作/读写属性、红外遥控、小爱音箱控制。所有操作通过参数化接口完成，无 shell 权限。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {
					"type": "string",
					"description": "要执行的操作名。可选值：login_qr / login_status / login_logout / config_get / config_set / discover / device_info / device_capabilities / get_prop / set_prop / run_action / device_action / device_prop / speaker_execute / speaker_play / speaker_list / speaker_status / discover_ir / ir_get_keys / ir_press_key"
				},
				"did": {
					"type": "string",
					"description": "设备 DID（精确匹配）"
				},
				"name": {
					"type": "string",
					"description": "设备名称（模糊匹配，单结果优先）"
				},
				"capability": {
					"type": "string",
					"description": "能力名称（如 turn_on / power / brightness / volume_up），用于 device_action / device_prop"
				},
				"siid": {
					"type": "integer",
					"description": "服务实例 ID（低层级 get_prop / set_prop / run_action 需要）"
				},
				"piid": {
					"type": "integer",
					"description": "属性实例 ID"
				},
				"aiid": {
					"type": "integer",
					"description": "动作实例 ID"
				},
				"value": {
					"description": "写入值（device_prop 写操作或 set_prop）"
				},
				"params": {
					"type": "array",
					"description": "动作入参数组（run_action / device_action）"
				},
				"parent_did": {
					"type": "string",
					"description": "红外控制器父设备 DID"
				},
				"controller_id": {
					"type": "string",
					"description": "红外子设备控制器 ID"
				},
				"key_id": {
					"type": "string",
					"description": "红外按键 ID（ir_press_key 需要）"
				},
				"text": {
					"type": "string",
					"description": "小爱音箱文本（speaker_execute / speaker_play）"
				},
				"volume": {
					"type": "integer",
					"description": "音量 0-100"
				},
				"silent": {
					"type": "boolean",
					"description": "是否静默执行（speaker_execute）"
				},
				"control": {
					"type": "string",
					"description": "播放控制：pause / play / resume / stop / volume"
				},
				"url": {
					"type": "string",
					"description": "音频 URL（speaker_play_url）"
				},
				"renew": {
					"type": "boolean",
					"description": "强制刷新设备缓存"
				},
				"summary_only": {
					"type": "boolean",
					"description": "discover 时只返回摘要"
				},
				"ticket": {
					"type": "string",
					"description": "二次验证 ticket（login_password 流程需要）"
				}
			},
			"required": ["action"]
		}`),
	}
}

// Handler is the MCP tool handler for mi_device.
func (c *Capability) Handler(ctx context.Context, req *mcp.CallToolRequest, _ any) (*mcp.CallToolResult, any, error) {
	start := time.Now()

	var in CapabilityRequest
	if req.Params != nil && len(req.Params.Arguments) > 0 {
		_ = json.Unmarshal(req.Params.Arguments, &in)
	}

	c.mu.Lock()
	auth := c.auth
	c.mu.Unlock()

	log.Printf("[mi_device] action=%s did=%s name=%s cap=%s", in.Action, in.DID, in.Name, in.Capability)

	result := Dispatch(auth, in)

	elapsed := time.Since(start)
	log.Printf("[mi_device] action=%s status=%s elapsed=%s", in.Action,
		map[bool]string{true: "ok", false: "err"}[result["status"] == "success"],
		elapsed.Round(time.Millisecond))

	text := fmt.Sprintf("mi_device %s: %s", in.Action, result["status"])
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
