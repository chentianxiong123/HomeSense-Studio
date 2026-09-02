package adb

import (
	"context"
	"encoding/json"
	"fmt"
	"os/exec"
	"os"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type Capability struct{}

func NewCapability() *Capability { return &Capability{} }

func (c *Capability) MCPTool() *mcp.Tool {
	return &mcp.Tool{
		Name:        "adb_cmd",
		Description: "Android ADB 设备控制：连接设备、查看状态、文件操作、屏幕截图、触控、按键、应用管理。ADB 必须在 PATH 中可用。",
		InputSchema: json.RawMessage(`{
			"type": "object",
			"properties": {
				"action": {"type": "string", "description": "操作名：list_devices / connect / disconnect / overview / list_files / read_file / remove_files / copy_files / pull_file / push_file / mkdir / screenshot / tap / swipe / input_text / press_key / back / home / enter / volume_up / volume_down / power / launch_app / get_current_app / list_packages / check_package / get_display_size / scrcpy_status / scrcpy_probe / scrcpy_command / capabilities"},
				"device": {"type": "string", "description": "设备序列号或 IP:port（如 192.168.1.100:5555）"},
				"path":   {"type": "string", "description": "设备端路径"},
				"dir":    {"type": "string", "description": "设备端目录（list_files/mkdir 使用）"},
				"dst_path": {"type": "string", "description": "目标路径"},
				"dst_dir":  {"type": "string", "description": "目标目录"},
				"x":  {"type": "integer", "description": "X 坐标"},
				"y":  {"type": "integer", "description": "Y 坐标"},
				"text": {"type": "string", "description": "输入文本"},
				"key":  {"type": "string", "description": "按键名（home/back/enter/volume_up/volume_down/power/wake）"},
				"package": {"type": "string", "description": "包名"},
				"timeout": {"type": "integer", "description": "超时秒数"},
				"src_file": {"type": "string", "description": "源文件（push/pull/copy）"},
				"dest_file": {"type": "string", "description": "目标文件"},
				"radius":  {"type": "integer", "description": "滑动半径"},
				"duration":{"type": "integer", "description": "滑动时长(ms)"},
				"profile": {"type": "string", "description": "scrcpy 配置：browser_bridge/desktop/window/headless"},
				"audio": {"type": "boolean", "description": "scrcpy 音频开关"},
				"window": {"type": "boolean", "description": "scrcpy 窗口模式"},
				"playback": {"type": "boolean", "description": "scrcpy 回放模式"},
				"max_size": {"type": "integer", "description": "scrcpy 最大分辨率"},
				"bit_rate": {"type": "integer", "description": "scrcpy 视频码率"},
				"max_fps": {"type": "integer", "description": "scrcpy 最大帧率"},
				"video_codec": {"type": "string", "description": "scrcpy 视频编码"},
				"display_id": {"type": "integer", "description": "scrcpy 显示器 ID"},
				"record": {"type": "string", "description": "scrcpy 录制文件路径"},
				"v4l2_sink": {"type": "string", "description": "scrcpy V4L2 接收器"},
				"include_overview": {"type": "boolean", "description": "scrcpy_probe 包含 overview"},
				"extra_args": {"type": "string", "description": "scrcpy 额外参数"}
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

	status := result["status"].(string)
	text := fmt.Sprintf("adb_cmd %s: %s", in.Action, status)
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
	case "list_devices", "devices":
		return c.handleListDevices()
	case "connect":
		return c.handleConnect(req)
	case "disconnect":
		return c.handleDisconnect(req)
	case "overview", "device_overview":
		return c.handleOverview(req)
	case "list_files", "read_dir":
		return c.handleListFiles(req)
	case "read_file", "preview_file":
		return c.handleReadFile(req)
	case "remove_files", "delete_files":
		return c.handleRemoveFiles(req)
	case "copy_files":
		return c.handleCopyFiles(req)
	case "pull_file", "download_file":
		return c.handlePullFile(req)
	case "push_file", "upload_file":
		return c.handlePushFile(req)
	case "mkdir_path", "mkdir":
		return c.handleMkdir(req)
	case "screenshot", "get_screenshot":
		return c.handleScreenshot(req)
	case "get_display_size":
		return c.handleGetDisplaySize(req)
	case "back":
		return c.handleBack()
	case "home":
		return c.handleHome()
	case "enter":
		return c.handleEnter()
	case "volume_up":
		return c.handleVolumeUp()
	case "volume_down":
		return c.handleVolumeDown()
	case "power":
		return c.handlePower()
	case "tap":
		return c.handleTap(req)
	case "swipe":
		return c.handleSwipe(req)
	case "input_text", "type":
		return c.handleInputText(req)
	case "press_key", "key", "wake", "wakeup":
		return c.handlePressKey(req)
	case "launch_app", "launch":
		return c.handleLaunchApp(req)
	case "get_current_app", "current_app":
		return c.handleGetCurrentApp(req)
	case "list_packages", "list_apps":
		return c.handleListPackages(req)
	case "check_package":
		return c.handleCheckPackage(req)
	case "capabilities":
		return c.handleCapabilities()
	case "scrcpy_status", "screen_stream_status":
		return c.handleScrcpyStatus(req)
	case "scrcpy_probe", "screen_stream_probe":
		return c.handleScrcpyProbe(req)
	case "scrcpy_command", "scrcpy_build_command", "screen_stream_command":
		return c.handleScrcpyCommand(req)
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("unknown action: %q", req.Action))
	}
}

// ─── handlers ───────────────────────────────────────────────────────────────

func (c *Capability) handleListDevices() map[string]any {
	out, errOut, code := deviceCmd("", "devices", "-l")
	if code != 0 && strings.Contains(errOut, "not found") {
		return fail("ADB_NOT_FOUND", "adb not found in PATH")
	}
	var devices []Device
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		parts := strings.Fields(line)
		if len(parts) < 2 || parts[0] == "List" || parts[0] == "emulator" {
			continue
		}
		devices = append(devices, Device{Serial: parts[0], State: parts[1]})
	}
	return map[string]any{"status": "success", "data": devices}
}

func (c *Capability) handleConnect(req Request) map[string]any {
	if req.Device == "" {
		return fail("INVALID_PARAMS", "device (IP:port) is required")
	}
	_, errOut, code := deviceCmd("", "connect", req.Device)
	if code != 0 {
		return fail("CONNECT_FAILED", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"device": req.Device}}
}

func (c *Capability) handleDisconnect(req Request) map[string]any {
	if req.Device == "" {
		return fail("INVALID_PARAMS", "device is required")
	}
	_, errOut, code := deviceCmd("", "disconnect", req.Device)
	if code != 0 {
		return fail("DISCONNECT_FAILED", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"device": req.Device}}
}

func (c *Capability) handleOverview(req Request) map[string]any {
	if req.Device == "" {
		return fail("INVALID_PARAMS", "device is required")
	}
	propsOut, _, _ := shell(req.Device, "getprop", 10*time.Second)
	wmSize, _, _ := shell(req.Device, "wm size", 5*time.Second)
	wmDensity, _, _ := shell(req.Device, "wm density", 5*time.Second)
	battery, _, _ := shell(req.Device, "dumpsys battery", 5*time.Second)
	ipAddr, _, _ := shell(req.Device, "ip addr show wlan0", 5*time.Second)
	curApp := c.handleGetCurrentApp(req)

	screen := reRes.FindStringSubmatch(wmSize)
	density := reDensity.FindStringSubmatch(wmDensity)
	ip := reIP.FindStringSubmatch(ipAddr)
	current := ""
	if curApp["status"] == "success" {
		if m, ok := curApp["data"].(map[string]any); ok {
			current, _ = m["package"].(string)
		}
	}

	return map[string]any{
		"status": "success",
		"data": map[string]any{
			"device": req.Device,
			"screen": map[string]any{"resolution": screenStr(screen), "density": densityStr(density)},
			"battery": cleanMultiLine(battery),
			"ip":      ipStr(ip),
			"current_app": current,
			"props_preview": firstLines(propsOut, 20),
		},
	}
}

func (c *Capability) handleListFiles(req Request) map[string]any {
	if req.Device == "" || req.Dir == "" {
		return fail("INVALID_PARAMS", "device and dir are required")
	}
	out, errOut, code := shell(req.Device, "ls -la "+req.Dir, 10*time.Second)
	if code < 0 {
		return fail("DEVICE_OFFLINE", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"path": req.Dir, "content": out}}
}

func (c *Capability) handleReadFile(req Request) map[string]any {
	if req.Device == "" || req.Path == "" {
		return fail("INVALID_PARAMS", "device and path are required")
	}
	out, errOut, code := shell(req.Device, "cat "+req.Path, 10*time.Second)
	if code < 0 {
		return fail("DEVICE_OFFLINE", errOut)
	}
	if code != 0 {
		return fail("READ_FAILED", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"path": req.Path, "content": out}}
}

func (c *Capability) handleRemoveFiles(req Request) map[string]any {
	if req.Device == "" || req.Path == "" {
		return fail("INVALID_PARAMS", "device and path are required")
	}
	_, errOut, code := shell(req.Device, "rm -rf "+req.Path, 10*time.Second)
	if code != 0 {
		return fail("REMOVE_FAILED", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"path": req.Path}}
}

func (c *Capability) handleCopyFiles(req Request) map[string]any {
	if req.Device == "" || req.Path == "" || req.DstPath == "" {
		return fail("INVALID_PARAMS", "device, path, and dst_path are required")
	}
	_, errOut, code := shell(req.Device, "cp -r "+req.Path+" "+req.DstPath, 10*time.Second)
	if code != 0 {
		return fail("COPY_FAILED", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"src": req.Path, "dst": req.DstPath}}
}

func (c *Capability) handlePullFile(req Request) map[string]any {
	if req.Device == "" || req.Path == "" {
		return fail("INVALID_PARAMS", "device and path are required")
	}
	dst := req.DstPath
	if dst == "" {
		dst = "."
	}
	_, errOut, code := deviceCmd("", "pull", "-p", "-s", req.Device, req.Path, dst)
	if code != 0 {
		return fail("PULL_FAILED", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"src": req.Path, "dst": dst}}
}

func (c *Capability) handlePushFile(req Request) map[string]any {
	if req.Device == "" || req.SrcFile == "" || req.DestFile == "" {
		return fail("INVALID_PARAMS", "src_file, dest_file, and device are required")
	}
	_, errOut, code := deviceCmd("", "push", req.SrcFile, req.DestFile)
	if code != 0 {
		return fail("PUSH_FAILED", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"src": req.SrcFile, "dst": req.DestFile}}
}

func (c *Capability) handleMkdir(req Request) map[string]any {
	if req.Device == "" || req.Dir == "" {
		return fail("INVALID_PARAMS", "device and dir are required")
	}
	_, errOut, code := shell(req.Device, "mkdir -p "+req.Dir, 10*time.Second)
	if code != 0 {
		return fail("MKDIR_FAILED", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"dir": req.Dir}}
}

func (c *Capability) handleScreenshot(req Request) map[string]any {
	if req.Device == "" {
		return fail("INVALID_PARAMS", "device is required")
	}
	tmp := "/tmp/screenshot_" + req.Device + ".png"
	_, _, code := shell(req.Device, "screencap -p "+tmp, 10*time.Second)
	if code != 0 {
		return fail("SCREENSHOT_FAILED", "failed to capture screen")
	}
	return map[string]any{"status": "success", "data": map[string]any{"path": tmp}}
}

func (c *Capability) handleGetDisplaySize(req Request) map[string]any {
	out, _, _ := shell(req.Device, "wm size", 5*time.Second)
	screen := reRes.FindStringSubmatch(out)
	density := reDensity.FindStringSubmatch(out)
	return map[string]any{"status": "success", "data": map[string]any{
		"resolution": screenStr(screen),
		"density":    densityStr(density),
	}}
}

func (c *Capability) handleTap(req Request) map[string]any {
	if req.Device == "" || req.X == 0 || req.Y == 0 {
		return fail("INVALID_PARAMS", "x and y are required")
	}
	_, _, code := shell(req.Device, fmt.Sprintf("input tap %d %d", req.X, req.Y), 5*time.Second)
	if code != 0 {
		return fail("TAP_FAILED", "")
	}
	return map[string]any{"status": "success", "data": map[string]any{"x": req.X, "y": req.Y}}
}

func (c *Capability) handleSwipe(req Request) map[string]any {
	if req.Device == "" || req.X1 == 0 || req.Y1 == 0 || req.X2 == 0 || req.Y2 == 0 {
		return fail("INVALID_PARAMS", "x1,y1,x2,y2 are required")
	}
dur := 300
	if req.Duration > 0 {
		dur = req.Duration
	}
	_, _, code := shell(req.Device, fmt.Sprintf("input swipe %d %d %d %d %d", req.X1, req.Y1, req.X2, req.Y2, dur), 5*time.Second)
	if code != 0 {
		return fail("SWIPE_FAILED", "")
	}
	return map[string]any{"status": "success", "data": map[string]any{"x1": req.X1, "y1": req.Y1, "x2": req.X2, "y2": req.Y2}}
}

func (c *Capability) handleInputText(req Request) map[string]any {
	if req.Device == "" || req.Text == "" {
		return fail("INVALID_PARAMS", "text is required")
	}
	_, _, code := shell(req.Device, "input text "+strings.ReplaceAll(req.Text, " ", "%s"), 5*time.Second)
	if code != 0 {
		return fail("INPUT_FAILED", "")
	}
	return map[string]any{"status": "success"}
}

func (c *Capability) handlePressKey(req Request) map[string]any {
	k := req.Key
	if k == "" {
		k = "back"
	}
	code := keyEvent(k)
	if code == 0 {
		return fail("INVALID_KEY", fmt.Sprintf("unknown key: %s", k))
	}
	_, _, code2 := shell(req.Device, fmt.Sprintf("input keyevent %d", code), 5*time.Second)
	if code2 != 0 {
		return fail("KEY_FAILED", "")
	}
	return map[string]any{"status": "success", "data": map[string]any{"key": k}}
}

func (c *Capability) handleBack() map[string]any  { return c.handlePressKey(Request{Key: "back"}) }
func (c *Capability) handleHome() map[string]any { return c.handlePressKey(Request{Key: "home"}) }
func (c *Capability) handleEnter() map[string]any { return c.handlePressKey(Request{Key: "enter"}) }
func (c *Capability) handleVolumeUp() map[string]any { return c.handlePressKey(Request{Key: "volume_up"}) }
func (c *Capability) handleVolumeDown() map[string]any { return c.handlePressKey(Request{Key: "volume_down"}) }
func (c *Capability) handlePower() map[string]any { return c.handlePressKey(Request{Key: "power"}) }

func (c *Capability) handleLaunchApp(req Request) map[string]any {
	if req.Device == "" || req.Package == "" {
		return fail("INVALID_PARAMS", "package is required")
	}
	_, errOut, code := shell(req.Device, "am start -n "+req.Package, 10*time.Second)
	if code != 0 {
		return fail("LAUNCH_FAILED", errOut)
	}
	return map[string]any{"status": "success", "data": map[string]any{"package": req.Package}}
}

func (c *Capability) handleGetCurrentApp(req Request) map[string]any {
	dev := req.Device
	if dev == "" {
		return fail("INVALID_PARAMS", "device is required")
	}
	out, _, _ := shell(dev, "dumpsys activity activities | grep -E 'mResumedActivity|mFocusedActivity'", 10*time.Second)
	m := reCurrent.FindStringSubmatch(out)
	if len(m) < 3 {
		return map[string]any{"status": "success", "data": map[string]any{"package": "", "activity": ""}}
	}
	return map[string]any{"status": "success", "data": map[string]any{"package": m[1], "activity": m[2]}}
}

func (c *Capability) handleListPackages(req Request) map[string]any {
	if req.Device == "" {
		return fail("INVALID_PARAMS", "device is required")
	}
	out, _, code := shell(req.Device, "pm list packages"+req.PackageFlag(), 10*time.Second)
	if code != 0 {
		return fail("LIST_FAILED", "")
	}
	var pkgs []string
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "package:") {
			pkgs = append(pkgs, strings.TrimPrefix(line, "package:"))
		}
	}
	return map[string]any{"status": "success", "data": map[string]any{"packages": pkgs, "count": len(pkgs)}}
}

func (c *Capability) handleCheckPackage(req Request) map[string]any {
	if req.Device == "" || req.Package == "" {
		return fail("INVALID_PARAMS", "package is required")
	}
	_, _, code := shell(req.Device, "pm path "+req.Package, 5*time.Second)
	if code == 0 {
		return map[string]any{"status": "success", "data": map[string]any{"package": req.Package, "exists": true}}
	}
	return map[string]any{"status": "success", "data": map[string]any{"package": req.Package, "exists": false}}
}

// ─── scrcpy streaming ────────────────────────────────────────────────────────

func scrcpyExecutable() string {
	bin, err := exec.LookPath("scrcpy")
	if err != nil {
		return "scrcpy"
	}
	return bin
}

func (c *Capability) handleScrcpyStatus(req Request) map[string]any {
	bin := scrcpyExecutable()
	cmd := exec.Command(bin, "--version")
	cmd.Env = append(os.Environ(), "ADB_PATH="+bin)
	out, errOut, code := run(Command{Bin: bin, Args: []string{"--version"}, Timeout: 5 * time.Second})
	if code != 0 {
		return map[string]any{"status": "error", "error": "SCRCPY_NOT_FOUND", "data": map[string]any{"available": false, "path": bin, "message": errOut}}
	}
	version := ""
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "scrcpy") {
			parts := strings.Fields(line)
			if len(parts) >= 2 {
				version = parts[1]
			}
			break
		}
	}
	return map[string]any{"status": "success", "data": map[string]any{
		"available": code == 0, "path": bin, "version": version,
		"raw": out, "return_code": code,
	}}
}

func (c *Capability) handleScrcpyProbe(req Request) map[string]any {
	timeout := req.Timeout
	if timeout == 0 {
		timeout = 5
	}
	status := c.handleScrcpyStatus(req)
	if status["error"] != "" {
		return status
	}
	display := c.handleGetDisplaySize(req)
	device := req.Device
	if device == "" {
		devices := c.handleListDevices()
		if devs, ok := devices["data"].([]Device); ok && len(devs) > 0 {
			device = devs[0].Serial
		}
	}
	profile := req.Profile
	if profile == "" {
		profile = "browser_bridge"
	}
	cmd := c.scrcpyCommandSpec(req, device, profile, false, false, false)
	ready := status["data"].(map[string]any)["available"] == true && display["status"] == "success"
	return map[string]any{
		"status":    map[bool]string{true: "success", false: "error"}[ready],
		"error":     nil,
		"data":      cmd["data"],
		"ready":     ready,
		"blockers": func() []string {
			var blockers []string
			if status["error"] != "" {
				blockers = append(blockers, "SCRCPY_UNAVAILABLE")
			}
			if display["status"] != "success" {
				blockers = append(blockers, "DISPLAY_PROBE_FAILED")
			}
			return blockers
		}(),
	}
}

func (c *Capability) handleScrcpyCommand(req Request) map[string]any {
	device := req.Device
	if device == "" {
		devices := c.handleListDevices()
		if devs, ok := devices["data"].([]Device); ok && len(devs) > 0 {
			device = devs[0].Serial
		}
	}
	profile := req.Profile
	if profile == "" {
		profile = "browser_bridge"
	}
	return c.scrcpyCommandSpec(req, device, profile, req.Audio, req.Window, req.Playback)
}

func (c *Capability) scrcpyCommandSpec(req Request, device, profile string, audio, window, playback bool) map[string]any {
	bin := scrcpyExecutable()
	args := []string{}
	if device != "" {
		args = append(args, "-s", device)
	}
	args = scrcpyAppend(args, req.MaxSize > 0, "--max-size", fmt.Sprint(req.MaxSize))
	args = scrcpyAppend(args, req.BitRate > 0, "--video-bit-rate", fmt.Sprint(req.BitRate))
	args = scrcpyAppend(args, req.MaxFPS > 0, "--max-fps", fmt.Sprint(req.MaxFPS))
	args = scrcpyAppend(args, req.VideoCodec != "", "--video-codec", req.VideoCodec)
	args = scrcpyAppend(args, req.DisplayID > 0, "--display-id", fmt.Sprint(req.DisplayID))
	if !audio {
		args = append(args, "--no-audio")
	}
	if !window {
		args = append(args, "--no-window")
	}
	args = scrcpyAppend(args, req.Record != "", "--record", req.Record)
	args = scrcpyAppend(args, req.V4L2Sink != "", "--v4l2-sink", req.V4L2Sink)
	if req.ExtraArgs != "" {
		args = append(args, strings.Fields(req.ExtraArgs)...)
	}
	cmd := bin + " " + strings.Join(args, " ")
	return map[string]any{
		"status":        "success",
		"data":          map[string]any{
			"executable":   bin,
			"args":         args,
			"command_line": cmd,
			"device":       device,
			"profile":      profile,
			"headless":     !window,
			"window":       window,
			"audio":        audio,
			"control":      true,
			"requires_backend_bridge": profile == "browser_bridge" || profile == "web",
		},
		"notes": []string{
			"scrcpy starts a device-side server over ADB and opens video/audio/control sockets.",
			"For browser delivery, use a backend bridge or standalone raw stream session.",
		},
	}
}

func scrcpyAppend(args []string, cond bool, flag, value string) []string {
	if cond {
		return append(args, flag, value)
	}
	return args
}

func (c *Capability) handleCapabilities() map[string]any {
	actions := []string{
		"list_devices", "connect", "disconnect", "overview",
		"list_files", "read_file", "remove_files", "copy_files",
		"pull_file", "push_file", "mkdir",
		"screenshot", "get_display_size",
		"tap", "swipe", "input_text", "press_key",
		"back", "home", "enter", "volume_up", "volume_down", "power",
		"launch_app", "get_current_app", "list_packages", "check_package",
		"scrcpy_status", "scrcpy_probe", "scrcpy_command",
	}
	return map[string]any{
		"status":  "success",
		"data":    map[string]any{"actions": actions},
	}
}

// ─── helpers ────────────────────────────────────────────────────────────────

func (r Request) PackageFlag() string {
	if r.Package != "" {
		return " -f"
	}
	return ""
}

func screenStr(m []string) string {
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}
func densityStr(m []string) string {
	if len(m) >= 2 {
		return m[1]
	}
	return ""
}
func ipStr(m []string) string {
	if len(m) >= 1 {
		return m[0]
	}
	return ""
}
func cleanMultiLine(s string) string {
	lines := strings.Split(strings.TrimSpace(s), "\n")
	for i, l := range lines {
		lines[i] = strings.TrimSpace(l)
	}
	return strings.Join(lines, " | ")
}
func firstLines(s string, n int) string {
	lines := strings.SplitN(s, "\n", n)
	result := make([]string, 0, len(lines))
	for _, l := range lines {
		if strings.TrimSpace(l) != "" {
			result = append(result, strings.TrimSpace(l))
		}
	}
	return strings.Join(result, "\n")
}
