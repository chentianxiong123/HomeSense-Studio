package mi

import (
	"fmt"
	"os"
	"strings"
)

// Discover scans the Mi home and returns cached or live results.
func Discover(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录，请先执行 login_qr 登录")
	}

	// Check cache first
	cached, err := readDeviceCache()
	noCache := err != nil || len(cached) == 0
	if !noCache && !req.Renew {
		return buildDiscoverResponse(cached, req.SummaryOnly, false)
	}

	homes, err := discoverHomes(a)
	if err != nil {
		if !noCache {
			return buildDiscoverResponse(cached, req.SummaryOnly, true)
		}
		return fail("NETWORK_TIMEOUT", fmt.Sprintf("获取家庭列表失败: %v", err))
	}

	allDevices := make([]Device, 0)
	for _, h := range homes {
		homeID, _ := h["id"].(float64)
		if homeID == 0 {
			homeID, _ = h["home_id"].(float64)
		}
		rawDevs, err := discoverDevices(a, homeID)
		if err != nil {
			continue
		}
		homeName, _ := h["name"].(string)
		for _, rd := range rawDevs {
			did, _ := rd["did"].(string)
			name, _ := rd["name"].(string)
			model, _ := rd["model"].(string)
			mfr, _ := rd["manufacturer"].(string)
			connType, _ := rd["connection_type"].(string)
			room, _ := rd["room_name"].(string)
			dt, _ := rd["device_type"].(string)
			// Extract capability controls from raw device data
			controls := extractControls(rd)
			allDevices = append(allDevices, Device{
				DID:          did,
				Name:         name,
				Model:        model,
				Manufacturer: mfr,
				ConnType:     connType,
				RoomName:     room,
				HomeName:     homeName,
				HomeID:       int(homeID),
				DeviceType:   dt,
				Controls:     controls,
			})
		}
	}

	if err := writeDeviceCache(allDevices); err != nil {
		// Non-fatal; cache write failure should not break the response
	}
	return buildDiscoverResponse(allDevices, req.SummaryOnly, false)
}

func extractControls(raw map[string]any) map[string]DeviceControl {
	// Parse features from raw device data
	// In production this would call the spec API; here we extract from the raw response
	controls := make(map[string]DeviceControl)
	features, _ := raw["features"].([]any)
	for _, f := range features {
		fm, _ := f.(map[string]any)
		name, _ := fm["name"].(string)
		if name == "" {
			continue
		}
		siid, _ := fm["siid"].(float64)
		piid, _ := fm["piid"].(float64)
		aiid, _ := fm["aiid"].(float64)
		kind, _ := fm["type"].(string)
		ctrl := DeviceControl{}
		if piid > 0 {
			ctrl.PiID = int(piid)
		}
		if aiid > 0 {
			ctrl.AiID = int(aiid)
		}
		if siid > 0 {
			ctrl.SiID = int(siid)
		}
		if kind == "action" && ctrl.AiID > 0 {
			ctrl.Type = "action"
		} else if kind == "property" && ctrl.PiID > 0 {
			ctrl.Type = "property"
		}
		controls[name] = ctrl
	}
	return controls
}

func buildDiscoverResponse(devices []Device, summaryOnly, stale bool) map[string]any {
	summary := make([]DiscoverSummary, 0, len(devices))
	for _, d := range devices {
		actions, props := splitControls(d.Controls)
		summary = append(summary, DiscoverSummary{
			DID:        d.DID,
			Name:       d.Name,
			Model:      d.Model,
			Room:       d.RoomName,
			DeviceType: d.DeviceType,
			Actions:    actions,
			Properties: props,
		})
	}
	result := map[string]any{"summary": summary, "count": len(summary)}
	if !summaryOnly {
		result["devices"] = devices
	}
	if stale {
		result["stale"] = true
		result["warning"] = "米家云端探测失败，已返回本地设备缓存"
	}
	return map[string]any{"status": "success", "data": result}
}

func splitControls(controls map[string]DeviceControl) (actions, props []string) {
	for name, c := range controls {
		if c.AiID > 0 {
			actions = append(actions, name)
		}
		if c.PiID > 0 {
			props = append(props, name)
		}
	}
	return
}

// DeviceInfo returns detailed info for a single device.
func DeviceInfo(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	devices, err := resolveDevices(a, req)
	if err != nil {
		return errResp(err)
	}
	d, err := findDevice(devices, req.DID, req.Name)
	if err != nil {
		return fail("DEVICE_NOT_FOUND", err.Error())
	}
	actions, props := splitControls(d.Controls)
	return map[string]any{
		"status": "success",
		"data": map[string]any{
			"did":         d.DID,
			"name":        d.Name,
			"model":       d.Model,
			"manufacturer": d.Manufacturer,
			"room":        d.RoomName,
			"home":        d.HomeName,
			"device_type": d.DeviceType,
			"capabilities": map[string][]string{
				"actions":    actions,
				"properties": props,
			},
			"controls": d.Controls,
		},
	}
}

func resolveDevices(a *AuthState, req CapabilityRequest) ([]Device, error) {
	devices, err := readDeviceCache()
	if err == nil && len(devices) > 0 && !req.Renew {
		return devices, nil
	}
	result := Discover(a, req)
	if result["status"] == "error" {
		return nil, fmt.Errorf("%v", result["message"])
	}
	data, _ := result["data"].(map[string]any)
	rawDevices, _ := data["devices"].([]Device)
	if len(rawDevices) == 0 {
		return nil, fmt.Errorf("no devices found")
	}
	return rawDevices, nil
}

// DeviceAction executes a named capability action on a device.
func DeviceAction(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	devices, err := resolveDevices(a, req)
	if err != nil {
		return errResp(err)
	}
	d, err := findDevice(devices, req.DID, req.Name)
	if err != nil {
		return fail("DEVICE_NOT_FOUND", err.Error())
	}
	ctrl, ok := d.Controls[req.Capability]
	if !ok {
		available := []string{}
		for n, c := range d.Controls {
			if c.AiID > 0 {
				available = append(available, n)
			}
		}
		return fail("CAPABILITY_NOT_FOUND",
			fmt.Sprintf("能力 '%s' 不存在，可用: %s", req.Capability, strings.Join(available, ", ")))
	}
	if ctrl.AiID == 0 {
		return fail("CAPABILITY_NOT_FOUND", fmt.Sprintf("能力 '%s' 没有 aiid", req.Capability))
	}
	result, err := requestAPI(a, "/miotspec/action", map[string]any{
		"params": map[string]any{
			"did":  d.DID,
			"siid": ctrl.SiID,
			"aiid": ctrl.AiID,
			"in":   req.Params,
		},
	})
	if err != nil {
		return fail("DEVICE_OFFLINE", err.Error())
	}
	return map[string]any{"status": "success", "data": result, "capability": req.Capability}
}

// DeviceProp reads or writes a property on a device.
func DeviceProp(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	devices, err := resolveDevices(a, req)
	if err != nil {
		return errResp(err)
	}
	d, err := findDevice(devices, req.DID, req.Name)
	if err != nil {
		return fail("DEVICE_NOT_FOUND", err.Error())
	}
	ctrl, ok := d.Controls[req.Capability]
	if !ok {
		available := []string{}
		for n, c := range d.Controls {
			if c.PiID > 0 {
				available = append(available, n)
			}
		}
		return fail("CAPABILITY_NOT_FOUND",
			fmt.Sprintf("能力 '%s' 不存在，可用: %s", req.Capability, strings.Join(available, ", ")))
	}
	if ctrl.PiID == 0 {
		return fail("CAPABILITY_NOT_FOUND", fmt.Sprintf("能力 '%s' 没有 piid", req.Capability))
	}

	if req.Value != nil {
		// Write
		result, err := requestAPI(a, "/miotspec/prop/set", map[string]any{
			"params": []map[string]any{
				{"did": d.DID, "siid": ctrl.SiID, "piid": ctrl.PiID, "value": req.Value},
			},
		})
		if err != nil {
			return fail("DEVICE_OFFLINE", err.Error())
		}
		return map[string]any{"status": "success", "data": result, "capability": req.Capability}
	}
	// Read
	result, err := requestAPI(a, "/miotspec/prop/get", map[string]any{
		"params":    []map[string]any{{"did": d.DID, "siid": ctrl.SiID, "piid": ctrl.PiID}},
		"datasource": float64(1),
	})
	if err != nil {
		return fail("DEVICE_OFFLINE", err.Error())
	}
	return map[string]any{"status": "success", "data": result, "capability": req.Capability}
}

func handleGetProp(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	if req.DID == "" || req.SiID == 0 || req.PiID == 0 {
		return fail("INVALID_PARAMS", "缺少 did/siid/piid")
	}
	result, err := requestAPI(a, "/miotspec/prop/get", map[string]any{
		"params":    []map[string]any{{"did": req.DID, "siid": req.SiID, "piid": req.PiID}},
		"datasource": float64(1),
	})
	if err != nil {
		return fail("DEVICE_OFFLINE", err.Error())
	}
	return map[string]any{"status": "success", "data": result}
}

func handleSetProp(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	if req.DID == "" || req.SiID == 0 || req.PiID == 0 {
		return fail("INVALID_PARAMS", "缺少 did/siid/piid")
	}
	result, err := requestAPI(a, "/miotspec/prop/set", map[string]any{
		"params": []map[string]any{
			{"did": req.DID, "siid": req.SiID, "piid": req.PiID, "value": req.Value},
		},
	})
	if err != nil {
		return fail("DEVICE_OFFLINE", err.Error())
	}
	return map[string]any{"status": "success", "data": result}
}

func handleRunAction(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	if req.DID == "" || req.SiID == 0 || req.AiID == 0 {
		return fail("INVALID_PARAMS", "缺少 did/siid/aiid")
	}
	result, err := requestAPI(a, "/miotspec/action", map[string]any{
		"params": map[string]any{
			"did":  req.DID,
			"siid": req.SiID,
			"aiid": req.AiID,
			"in":   req.Params,
		},
	})
	if err != nil {
		return fail("DEVICE_OFFLINE", err.Error())
	}
	return map[string]any{"status": "success", "data": result}
}

// ---------------------------------------------------------------------------
// Auth endpoints
// ---------------------------------------------------------------------------

func HandleLoginQR(_ *AuthState, _ CapabilityRequest) map[string]any {
	// Returns QR data; user scans with Mi Home app then polls login_qr_status
	return map[string]any{
		"status":    "success",
		"qr_url":    "https://account.xiaomi.com/pass/qrcode/generate?sid=" + MiSID,
		"poll_url":  "https://account.xiaomi.com/pass/qrcode/poll",
		"hint":      "请使用米家 App 扫描上方二维码",
		"message":   "扫码登录（需在 Mi Home app 中确认）",
	}
}

func HandleLoginStatus(a *AuthState, req CapabilityRequest) map[string]any {
	forceRefresh := req.Renew || req.SummaryOnly // reuse renew flag
	if forceRefresh && a != nil {
		if err := refreshServiceToken(a); err != nil {
			return map[string]any{
				"status":      "success",
				"logged_in":   false,
				"token_valid": false,
				"message":     "Token 刷新失败: " + err.Error(),
			}
		}
	}
	valid := isTokenValid(a)
	return map[string]any{
		"status":     "success",
		"logged_in":  valid,
		"token_valid": valid,
		"user_id":    a.UserID,
		"message":    map[bool]string{true: "已登录", false: "未登录或 token 已过期"}[valid],
	}
}

func HandleLoginLogout(_ *AuthState, _ CapabilityRequest) map[string]any {
	os.Remove(authFile())
	os.Remove(deviceCacheFile())
	return map[string]any{"status": "success", "message": "已退出登录"}
}

func HandleConfigGet(_ *AuthState, _ CapabilityRequest) map[string]any {
	a, err := readAuth()
	if err != nil || a == nil {
		return map[string]any{"status": "success", "data": map[string]any{}}
	}
	return map[string]any{
		"status":    "success",
		"logged_in": isTokenValid(a),
		"user_id":   a.UserID,
		"device_id": a.DeviceID,
	}
}

func HandleConfigSet(a *AuthState, req CapabilityRequest) map[string]any {
	// Allows setting fields directly; used for debugging.
	// The main auth path is loginQR + poll.
	if req.Value != nil {
		m, _ := req.Value.(map[string]any)
		for k, v := range m {
			switch k {
			case "userId":
				a.UserID = v.(string)
			case "cUserId":
				a.CUserID = v.(string)
			case "ssecurity":
				a.Security = v.(string)
			case "serviceToken":
				a.ServiceToken = v.(string)
			case "passToken":
				a.PassToken = v.(string)
			case "deviceId":
				a.DeviceID = v.(string)
			}
		}
		writeAuth(a)
	}
	return HandleConfigGet(a, req)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func fail(code, msg string) map[string]any {
	return map[string]any{"status": "error", "error": code, "message": msg}
}

func errResp(err error) map[string]any {
	return fail("ERROR", err.Error())
}

// ---------------------------------------------------------------------------
// Speaker helpers
// ---------------------------------------------------------------------------

func isXiaoaiDevice(d Device) bool {
	n := strings.ToLower(d.Name)
	m := strings.ToLower(d.Model)
	markers := []string{"小爱", "xiaoai", "wifispeaker", "intelligent-speaker", "speaker", "l09", "l06", "s12", "lx04", "lx05a", "lx06"}
	for _, mk := range markers {
		if strings.Contains(n, mk) || strings.Contains(m, mk) {
			return true
		}
	}
	return false
}

func findSpeakerDIDs(devices []Device) []string {
	var dids []string
	for _, d := range devices {
		if isXiaoaiDevice(d) {
			dids = append(dids, d.DID)
		}
	}
	return dids
}

func speakerExecute(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	if req.Text == "" {
		return fail("INVALID_PARAMS", "缺少 text 参数")
	}
	devices, err := resolveDevices(a, req)
	if err != nil {
		return errResp(err)
	}
	speakers := findSpeakerDIDs(devices)
	if len(speakers) == 0 {
		return fail("DEVICE_NOT_FOUND", "未找到小爱音箱设备")
	}
	did := req.DID
	if did == "" {
		did = speakers[0]
	}
	text := req.Text
	if !req.Silent {
		text = "跟我说 " + text
	}
	// Use message_router action for speaker
	result, err := requestAPI(a, "/miot-spec-v2/service/speaker/action/router", map[string]any{
		"params": map[string]any{
			"did":  did,
			"text": text,
		},
	})
	if err != nil {
		return fail("DEVICE_OFFLINE", err.Error())
	}
	return map[string]any{"status": "success", "data": result}
}

func speakerPlay(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	if req.Text == "" {
		return fail("INVALID_PARAMS", "缺少 text 参数")
	}
	devices, err := resolveDevices(a, req)
	if err != nil {
		return errResp(err)
	}
	speakers := findSpeakerDIDs(devices)
	if len(speakers) == 0 {
		return fail("DEVICE_NOT_FOUND", "未找到小爱音箱设备")
	}
	did := req.DID
	if did == "" {
		did = speakers[0]
	}
	// play_text action
	result, err := requestAPI(a, "/miot-spec-v2/service/speaker/action/play_text", map[string]any{
		"params": map[string]any{
			"did":   did,
			"text":  req.Text,
			"silent": req.Silent,
		},
	})
	if err != nil {
		return fail("DEVICE_OFFLINE", err.Error())
	}
	return map[string]any{"status": "success", "data": result}
}

func speakerList(a *AuthState, _ CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	devices, err := resolveDevices(a, CapabilityRequest{})
	if err != nil {
		return errResp(err)
	}
	speakers := findSpeakerDIDs(devices)
	return map[string]any{
		"status":  "success",
		"data":    map[string]any{"speakers": speakers, "count": len(speakers)},
	}
}

func speakerStatus(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	devices, err := resolveDevices(a, req)
	if err != nil {
		return errResp(err)
	}
	speakers := findSpeakerDIDs(devices)
	did := req.DID
	if did == "" && len(speakers) > 0 {
		did = speakers[0]
	}
	if did == "" {
		return fail("DEVICE_NOT_FOUND", "未找到小爱音箱")
	}
	result, err := requestAPI(a, "/miot-spec-v2/service/speaker/property/status", map[string]any{
		"params": []map[string]any{{"did": did}},
	})
	if err != nil {
		return fail("API_ERROR", err.Error())
	}
	return map[string]any{"status": "success", "data": result, "did": did}
}

// ---------------------------------------------------------------------------
// IR remote
// ---------------------------------------------------------------------------

func irDiscover(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	parentDID := req.ParentDID
	if parentDID == "" {
		parentDID = req.DID
	}
	if parentDID == "" {
		return fail("INVALID_PARAMS", "缺少 parent_did 参数")
	}
	result, err := requestAPI(a, "/v2/irdevice/controllers", map[string]any{
		"parent_id": parentDID,
	})
	if err != nil {
		return fail("DEVICE_NOT_FOUND", err.Error())
	}
	raw, _ := result.(map[string]any)
	controllers, _ := raw["controllers"].([]any)
	if controllers == nil {
		controllers, _ = raw["result"].([]any)
	}
	out := make([]map[string]any, 0, len(controllers))
	for _, c := range controllers {
		m, _ := c.(map[string]any)
		out = append(out, map[string]any{
			"controller_id": m["controller_id"],
			"name":          m["name"],
			"type":          m["type"],
		})
	}
	return map[string]any{"status": "success", "data": map[string]any{"controllers": out}}
}

func irGetKeys(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	controllerID := req.ControllerID
	if controllerID == "" {
		controllerID = req.DID
	}
	if controllerID == "" {
		return fail("INVALID_PARAMS", "缺少 controller_id 或 did")
	}
	result, err := requestAPI(a, "/v2/irdevice/controller/keys", map[string]any{
		"did": controllerID,
	})
	if err != nil {
		return fail("DEVICE_NOT_FOUND", err.Error())
	}
	raw, _ := result.(map[string]any)
	keys, _ := raw["keys"].([]any)
	if keys == nil {
		keys, _ = raw["result"].([]any)
	}
	out := make([]map[string]any, 0, len(keys))
	for _, k := range keys {
		m, _ := k.(map[string]any)
		out = append(out, map[string]any{
			"key_id": m["key_id"],
			"name":   m["name"],
			"type":   m["type"],
		})
	}
	return map[string]any{"status": "success", "data": map[string]any{"keys": out}}
}

func irPressKey(a *AuthState, req CapabilityRequest) map[string]any {
	if !isTokenValid(a) {
		return fail("AUTH_FAILED", "未登录")
	}
	if req.KeyID == "" {
		return fail("INVALID_PARAMS", "缺少 key_id")
	}
	controllerID := req.ControllerID
	if controllerID == "" {
		controllerID = req.DID
	}
	if controllerID == "" {
		return fail("INVALID_PARAMS", "缺少 did 或 controller_id")
	}
	result, err := requestAPI(a, "/v2/irdevice/controller/key/click", map[string]any{
		"did":          controllerID,
		"key_id":       req.KeyID,
	})
	if err != nil {
		return fail("DEVICE_OFFLINE", err.Error())
	}
	return map[string]any{"status": "success", "data": result}
}

// ---------------------------------------------------------------------------
// Unified dispatcher — maps action strings to handlers
// ---------------------------------------------------------------------------

// Dispatch executes the requested mi_device action.
func Dispatch(a *AuthState, req CapabilityRequest) map[string]any {
	switch req.Action {
	// Auth
	case "login_qr":
		return HandleLoginQR(a, req)
	case "login_status":
		return HandleLoginStatus(a, req)
	case "login_logout":
		return HandleLoginLogout(a, req)
	case "config_get":
		return HandleConfigGet(a, req)
	case "config_set":
		return HandleConfigSet(a, req)
	// Device discovery
	case "discover":
		return Discover(a, req)
	case "device_info":
		return DeviceInfo(a, req)
	case "device_capabilities":
		return DeviceInfo(a, req) // same shape for now
	// Direct low-level API calls
	case "get_prop":
		return handleGetProp(a, req)
	case "set_prop":
		return handleSetProp(a, req)
	case "run_action":
		return handleRunAction(a, req)
	// AI-friendly high-level
	case "device_action":
		return DeviceAction(a, req)
	case "device_prop":
		return DeviceProp(a, req)
	// Speaker
	case "speaker_execute":
		return speakerExecute(a, req)
	case "speaker_play":
		return speakerPlay(a, req)
	case "speaker_list":
		return speakerList(a, req)
	case "speaker_status":
		return speakerStatus(a, req)
	// IR
	case "discover_ir":
		return irDiscover(a, req)
	case "ir_get_keys":
		return irGetKeys(a, req)
	case "ir_press_key":
		return irPressKey(a, req)
	default:
		return fail("ACTION_NOT_FOUND", fmt.Sprintf("未知 action: %q", req.Action))
	}
}
