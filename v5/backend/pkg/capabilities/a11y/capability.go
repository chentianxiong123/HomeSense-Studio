package a11y

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Node struct {
	XMLName     xml.Name `xml:"node"`
	ResourceID  string   `xml:"resource-id,attr"`
	ClassName   string   `xml:"class,attr"`
	Text        string   `xml:"text,attr"`
	ContentDesc string   `xml:"content-desc,attr"`
	Bounds      string   `xml:"bounds,attr"`
	Clickable   bool     `xml:"clickable,attr"`
	Scrollable  bool     `xml:"scrollable,attr"`
	Editable    bool     `xml:"editable,attr"`
	Enabled     bool     `xml:"enabled,attr"`
	Focused     bool     `xml:"focused,attr"`
	Child       []Node   `xml:"node"`
}

type DumpResponse struct {
	XMLName xml.Name `xml:"hierarchy"`
	Node    Node     `xml:"node"`
}

type Request struct {
	Action    string `json:"action"`
	Device    string `json:"device,omitempty"`
	Query     string `json:"query,omitempty"`
	Text      string `json:"text,omitempty"`
	Index     int    `json:"index,omitempty"`
	X         int    `json:"x,omitempty"`
	Y         int    `json:"y,omitempty"`
	Key       string `json:"key,omitempty"`
	Package   string `json:"package,omitempty"`
	Activity  string `json:"activity,omitempty"`
	Content   string `json:"content,omitempty"`
	Timeout   int    `json:"timeout,omitempty"`
	Limit     int    `json:"limit,omitempty"`
	Depth     int    `json:"depth,omitempty"`
	X1        int    `json:"x1,omitempty"`
	Y1        int    `json:"y1,omitempty"`
	X2        int    `json:"x2,omitempty"`
	Y2        int    `json:"y2,omitempty"`
	Duration  int    `json:"duration,omitempty"`
}

type Capability struct {
	adbBin string
}

func NewCapability() *Capability {
	adb, _ := exec.LookPath("adb")
	return &Capability{adbBin: adb}
}

func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "a11y_ctl",
		Description: "无障碍自动化：通过 ADB 读取屏幕 UI 树、搜索节点、点击/输入/滑动、截图、管理 App。适合控制智能电视、Android 设备及任意可见界面。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {"type": "string", "description": "操作名：devices / health / dump / find / tap / type / key / swipe / screenshot / back / home / launcher / app / clipboard / input_clipboard"},
				"device": {"type": "string", "description": "设备序列号或 IP:port"},
				"query": {"type": "string", "description": "搜索关键词（匹配 text / content-desc / resource-id）"},
				"text": {"type": "string", "description": "输入文本"},
				"index": {"type": "integer", "description": "匹配结果索引（0-based）"},
				"x": {"type": "integer", "description": "X 坐标"},
				"y": {"type": "integer", "description": "Y 坐标"},
				"key": {"type": "string", "description": "按键名：back / home / enter / menu / volume_up / volume_down / power / tab / space / delete / app_switch"},
				"package": {"type": "string", "description": "App 包名（启动/查看）"},
				"activity": {"type": "string", "description": "Activity 名"},
				"content": {"type": "string", "description": "剪贴板内容"},
				"timeout": {"type": "integer", "description": "超时秒数"},
				"limit": {"type": "integer", "description": "搜索结果最大条数"},
				"depth": {"type": "integer", "description": "树深度限制（1-5，默认 3）"},
				"x1": {"type": "integer", "description": "滑动起点 X"},
				"y1": {"type": "integer", "description": "滑动起点 Y"},
				"x2": {"type": "integer", "description": "滑动终点 X"},
				"y2": {"type": "integer", "description": "滑动终点 Y"},
				"duration": {"type": "integer", "description": "滑动持续时间（ms，默认 300）"}
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
	text := fmt.Sprintf("a11y_ctl %s: %s", in.Action, result["status"])
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
	case "health":
		return c.health()
	case "devices", "list_devices":
		return c.listDevices()
	case "dump", "get_tree", "ui_tree":
		return c.dump(req)
	case "find", "search", "query":
		return c.find(req)
	case "tap", "click":
		return c.tap(req)
	case "type", "input_text", "input":
		return c.typeText(req)
	case "key", "press_key", "send_key":
		return c.key(req)
	case "swipe", "scroll":
		return c.swipe(req)
	case "screenshot", "screen_capture":
		return c.screenshot(req)
	case "back":
		return c.back(req)
	case "home":
		return c.home(req)
	case "launcher", "home_screen":
		return c.launcher(req)
	case "app":
		return c.app(req)
	case "clipboard", "get_clipboard":
		return c.getClipboard(req)
	case "input_clipboard":
		return c.setClipboard(req)
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("unknown action: %q", req.Action))
	}
}

func (c *Capability) health() map[string]any {
	if c.adbBin == "" {
		return ok(map[string]any{"available": false, "message": "adb not found in PATH"})
	}
	return ok(map[string]any{
		"available": true,
		"adb_path":  c.adbBin,
		"message":   "a11y_ctl ready",
	})
}

func (c *Capability) listDevices() map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	out, errOut, code := adbCmd("", "devices", "-l")
	if code != 0 {
		return fail("DEVICE_LIST_FAILED", errOut)
	}
	var devices []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 || parts[0] == "List" || parts[0] == "emulator" {
			continue
		}
		d := map[string]any{"serial": parts[0], "state": parts[1]}
		if len(parts) >= 4 && parts[2] == "device" {
			d["product"] = parts[3]
		}
		devices = append(devices, d)
	}
	return ok(map[string]any{"devices": devices, "count": len(devices)})
}

func (c *Capability) dump(req Request) map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	depth := req.Depth
	if depth <= 0 {
		depth = 3
	}
	_, errOut, code := adbShell(req.Device, "uiautomator dump /sdcard/.uiautomator.dump 2>&1", 10*time.Second)
	if code != 0 {
		return fail("DUMP_FAILED", errOut)
	}
	treeOut, errOut, code := adbShell(req.Device, "cat /sdcard/.uiautomator.dump", 10*time.Second)
	if code != 0 {
		return fail("READ_FAILED", errOut)
	}
	parsed, err := parseDump(treeOut)
	if err != nil {
		return fail("PARSE_ERROR", err.Error())
	}
	pruned := pruneTree(parsed.Node, depth)
	items := extractItems(pruned, 0)
	return ok(map[string]any{
		"package":           parsed.Node.ResourceID,
		"depth":             depth,
		"total_nodes":       countNodes(pruned),
		"interactive_count": len(items),
		"items":             items,
	})
}

func (c *Capability) find(req Request) map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	if req.Query == "" {
		return fail("INVALID_PARAMS", "query is required")
	}
	_, errOut, code := adbShell(req.Device, "uiautomator dump /sdcard/.uiautomator.dump 2>&1", 10*time.Second)
	if code != 0 {
		return fail("DUMP_FAILED", errOut)
	}
	treeOut, errOut, code := adbShell(req.Device, "cat /sdcard/.uiautomator.dump", 10*time.Second)
	if code != 0 {
		return fail("READ_FAILED", errOut)
	}
	parsed, err := parseDump(treeOut)
	if err != nil {
		return fail("PARSE_ERROR", err.Error())
	}
	depth := req.Depth
	if depth <= 0 {
		depth = 4
	}
	pruned := pruneTree(parsed.Node, depth)
	matched := searchNodes(pruned, req.Query)
	limit := req.Limit
	if limit <= 0 {
		limit = 20
	}
	if len(matched) > limit {
		matched = matched[:limit]
	}
	return ok(map[string]any{"query": req.Query, "count": len(matched), "nodes": matched})
}

func (c *Capability) tap(req Request) map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	if req.X == 0 || req.Y == 0 {
		return fail("INVALID_PARAMS", "x and y are required")
	}
	_, errOut, code := adbShell(req.Device, fmt.Sprintf("input tap %d %d", req.X, req.Y), 5*time.Second)
	if code != 0 {
		return fail("TAP_FAILED", errOut)
	}
	return ok(map[string]any{"x": req.X, "y": req.Y, "action": "tap"})
}

func (c *Capability) typeText(req Request) map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	if req.Text == "" {
		return fail("INVALID_PARAMS", "text is required")
	}
	_, errOut, code := adbShell(req.Device, fmt.Sprintf("input text %q", req.Text), 5*time.Second)
	if code != 0 {
		return fail("INPUT_FAILED", errOut)
	}
	return ok(map[string]any{"text": req.Text, "chars": len(req.Text)})
}

func (c *Capability) key(req Request) map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	if req.Key == "" {
		return fail("INVALID_PARAMS", "key is required")
	}
	code := keyCode(req.Key)
	if code == 0 {
		return fail("INVALID_KEY", fmt.Sprintf("unknown key: %s", req.Key))
	}
	_, errOut, code2 := adbShell(req.Device, fmt.Sprintf("input keyevent %d", code), 5*time.Second)
	if code2 != 0 {
		return fail("KEY_FAILED", errOut)
	}
	return ok(map[string]any{"key": req.Key, "code": code})
}

func (c *Capability) swipe(req Request) map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	if req.X1 == 0 || req.Y1 == 0 || req.X2 == 0 || req.Y2 == 0 {
		return fail("INVALID_PARAMS", "x1,y1,x2,y2 are required")
	}
	duration := req.Duration
	if duration <= 0 {
		duration = 300
	}
	_, errOut, code := adbShell(req.Device, fmt.Sprintf("input swipe %d %d %d %d %d", req.X1, req.Y1, req.X2, req.Y2, duration), 5*time.Second)
	if code != 0 {
		return fail("SWIPE_FAILED", errOut)
	}
	return ok(map[string]any{"x1": req.X1, "y1": req.Y1, "x2": req.X2, "y2": req.Y2, "duration_ms": duration})
}

func (c *Capability) screenshot(req Request) map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	tmp := "/tmp/a11y_screenshot_" + strconv.FormatInt(time.Now().UnixNano(), 10) + ".png"
	_, errOut, code := adbShell(req.Device, fmt.Sprintf("screencap -p %s 2>&1", tmp), 10*time.Second)
	if code != 0 {
		return fail("SCREENSHOT_FAILED", errOut)
	}
	data, err := os.ReadFile(tmp)
	os.Remove(tmp)
	if err != nil {
		return fail("SCREENSHOT_READ", err.Error())
	}
	w, h := parseScreenshotSize(data)
	return ok(map[string]any{
		"width":      w,
		"height":     h,
		"size_bytes": len(data),
		"format":     "png",
		"base64":     "data:image/png;base64," + base64.StdEncoding.EncodeToString(data),
	})
}

func (c *Capability) back(req Request) map[string]any {
	return c.key(Request{Device: req.Device, Key: "back"})
}

func (c *Capability) home(req Request) map[string]any {
	return c.key(Request{Device: req.Device, Key: "home"})
}

func (c *Capability) launcher(req Request) map[string]any {
	_, errOut, code := adbShell(req.Device, "am start -a android.intent.action.MAIN -c android.intent.category.HOME", 5*time.Second)
	if code != 0 {
		return fail("LAUNCHER_FAILED", errOut)
	}
	return ok(map[string]any{"action": "launcher"})
}

func (c *Capability) app(req Request) map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	if req.Package == "" {
		return fail("INVALID_PARAMS", "package is required")
	}
	if req.Activity == "" {
		activity, errOut, code := adbShell(req.Device, fmt.Sprintf("cmd package resolve-activity --brief %s 2>&1", req.Package), 5*time.Second)
		if code != 0 {
			return fail("APP_RESOLVE_FAILED", errOut)
		}
		for _, line := range strings.Split(strings.TrimSpace(activity), "\n") {
			line = strings.TrimSpace(line)
			if strings.Contains(line, "/") {
				parts := strings.SplitN(line, "/", 2)
				if len(parts) == 2 && parts[1] != "" {
					req.Activity = parts[1]
					break
				}
			}
		}
		if req.Activity == "" {
			req.Activity = ".MainActivity"
		}
	}
	start := req.Package + "/" + req.Activity
	_, errOut, code := adbShell(req.Device, fmt.Sprintf("am start -n %s", start), 5*time.Second)
	if code != 0 {
		return fail("APP_LAUNCH_FAILED", errOut)
	}
	return ok(map[string]any{"package": req.Package, "activity": req.Activity, "action": "launched"})
}

func (c *Capability) getClipboard(req Request) map[string]any {
	_, errOut, code := adbShell(req.Device, "cmd clipboard get-clip 2>&1", 5*time.Second)
	if code != 0 {
		return ok(map[string]any{"clipboard": "", "note": "clipboard access requires ADB permission"})
	}
	return ok(map[string]any{"clipboard": strings.TrimSpace(errOut)})
}

func (c *Capability) setClipboard(req Request) map[string]any {
	if !c.ensureADB() {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	if req.Content == "" {
		return fail("INVALID_PARAMS", "content is required")
	}
	_, errOut, code := adbShell(req.Device, fmt.Sprintf("cmd clipboard set-clip text/plain %q", req.Content), 5*time.Second)
	if code != 0 {
		return fail("CLIPBOARD_SET_FAILED", errOut)
	}
	return ok(map[string]any{"clipboard": req.Content})
}

func (c *Capability) ensureADB() bool {
	if c.adbBin != "" {
		return true
	}
	c.adbBin, _ = exec.LookPath("adb")
	return c.adbBin != ""
}

// ─── ADB helpers ─────────────────────────────────────────────────────────────

func adbCmd(device string, args ...string) (string, string, int) {
	cmdArgs := []string{}
	if device != "" {
		cmdArgs = append(cmdArgs, "-s", device)
	}
	cmdArgs = append(cmdArgs, args...)
	timeout := 15 * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	c := exec.CommandContext(ctx, "adb", cmdArgs...)
	out, err := c.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return "", "TIMEOUT", -1
	}
	if err != nil {
		errOut := string(out)
		return errOut, errOut, -1
	}
	return string(out), "", 0
}

func adbShell(device string, cmd string, timeout time.Duration) (string, string, int) {
	args := []string{"shell", cmd}
	if device != "" {
		args = []string{"-s", device, "shell", cmd}
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	c := exec.CommandContext(ctx, "adb", args...)
	out, err := c.CombinedOutput()
	if ctx.Err() == context.DeadlineExceeded {
		return "", "TIMEOUT", -1
	}
	if err != nil {
		errOut := string(out)
		return "", errOut, -1
	}
	return string(out), "", 0
}

// ─── ADB key event codes ─────────────────────────────────────────────────────

func keyCode(name string) int {
	m := map[string]int{
		"back": 4, "home": 3, "enter": 66, "menu": 82,
		"volume_up": 25, "volume_down": 24, "power": 26,
		"tab": 61, "space": 62, "delete": 67,
		"app_switch": 187, "recent": 187,
	}
	if v, ok := m[strings.ToLower(name)]; ok {
		return v
	}
	if n, err := strconv.Atoi(name); err == nil {
		return n
	}
	return 0
}

// ─── UI tree parsing ─────────────────────────────────────────────────────────

func parseDump(raw string) (*DumpResponse, error) {
	raw = strings.TrimSpace(raw)
	idx := strings.Index(raw, "<hierarchy")
	if idx < 0 {
		return nil, fmt.Errorf("no hierarchy tag found")
	}
	raw = raw[idx:]
	var resp DumpResponse
	if err := xml.Unmarshal([]byte(raw), &resp); err != nil {
		return nil, fmt.Errorf("xml parse: %w", err)
	}
	return &resp, nil
}

func pruneTree(n Node, depth int) Node {
	if depth <= 0 {
		return Node{ClassName: n.ClassName, Text: n.Text, Bounds: n.Bounds}
	}
	out := n
	out.Child = nil
	for _, c := range n.Child {
		out.Child = append(out.Child, pruneTree(c, depth-1))
	}
	return out
}

func countNodes(n Node) int {
	c := 1
	for _, ch := range n.Child {
		c += countNodes(ch)
	}
	return c
}

func parseBounds(s string) (int, int, int, int) {
	re := regexp.MustCompile(`\[(\d+),(\d+)\]\[(\d+),(\d+)\]`)
	m := re.FindStringSubmatch(s)
	if len(m) < 5 {
		return 0, 0, 0, 0
	}
	l, _ := strconv.Atoi(m[1])
	t, _ := strconv.Atoi(m[2])
	r, _ := strconv.Atoi(m[3])
	b, _ := strconv.Atoi(m[4])
	return l, t, r, b
}

func center(x1, y1, x2, y2 int) (int, int) {
	return (x1 + x2) / 2, (y1 + y2) / 2
}

func extractItems(n Node, depth int) []map[string]any {
	if depth > 5 {
		return nil
	}
	var items []map[string]any
	isInteractive := n.Clickable || n.Scrollable || n.Editable || (n.Enabled && (n.Text != "" || n.ContentDesc != ""))
	if isInteractive {
		l, t, r, b := parseBounds(n.Bounds)
		x, y := center(l, t, r, b)
		item := map[string]any{
			"class":    n.ClassName,
			"text":     n.Text,
			"desc":     n.ContentDesc,
			"bounds":   n.Bounds,
			"tap":      map[string]any{"x": x, "y": y},
			"depth":    depth,
			"interactive": true,
		}
		if n.ResourceID != "" {
			item["resource_id"] = n.ResourceID
		}
		items = append(items, item)
	}
	for _, ch := range n.Child {
		items = append(items, extractItems(ch, depth+1)...)
	}
	return items
}

func searchNodes(n Node, query string) []map[string]any {
	var matched []map[string]any
	lq := strings.ToLower(query)
	matches := strings.Contains(strings.ToLower(n.Text), lq) ||
		strings.Contains(strings.ToLower(n.ContentDesc), lq) ||
		strings.Contains(strings.ToLower(n.ResourceID), lq) ||
		strings.Contains(strings.ToLower(n.ClassName), lq)
	if matches {
		l, t, r, b := parseBounds(n.Bounds)
		x, y := center(l, t, r, b)
		matched = append(matched, map[string]any{
			"class":       n.ClassName,
			"text":        n.Text,
			"desc":        n.ContentDesc,
			"resource_id": n.ResourceID,
			"bounds":      n.Bounds,
			"tap":         map[string]any{"x": x, "y": y},
		})
	}
	for _, ch := range n.Child {
		matched = append(matched, searchNodes(ch, query)...)
	}
	return matched
}

// ─── screenshot size ─────────────────────────────────────────────────────────

func parseScreenshotSize(data []byte) (int, int) {
	re := regexp.MustCompile(`Png\.Properties: (\d+)x(\d+)`)
	m := re.FindSubmatch(data)
	if len(m) < 3 {
		return 0, 0
	}
	w, _ := strconv.Atoi(string(m[1]))
	h, _ := strconv.Atoi(string(m[2]))
	return w, h
}

// ─── response helpers ────────────────────────────────────────────────────────

func fail(code, msg string) map[string]any {
	return map[string]any{"status": "error", "error": code, "message": msg}
}

func ok(data any) map[string]any {
	return map[string]any{"status": "success", "data": data}
}
