// Package adapters bridges HomeSense tool handlers to workflow.CapabilityCaller.
// Each adapter is a thin shim that translates between the rule engine's
// generic action+parameters interface and a tool's strongly typed request.
package adapters

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/sipeed/picoclaw/pkg/capabilities/a11y"
	"github.com/sipeed/picoclaw/pkg/capabilities/adb"
	"github.com/sipeed/picoclaw/pkg/capabilities/alist"
	"github.com/sipeed/picoclaw/pkg/capabilities/bilibili"
	"github.com/sipeed/picoclaw/pkg/capabilities/dlna"
	"github.com/sipeed/picoclaw/pkg/capabilities/media"
	"github.com/sipeed/picoclaw/pkg/capabilities/mi"
	"github.com/sipeed/picoclaw/pkg/capabilities/moonlight"
	"github.com/sipeed/picoclaw/pkg/capabilities/remote_desktop"
	"github.com/sipeed/picoclaw/pkg/workflow"
)

// miDeviceCaller wraps mi.Capability as a workflow tool. It assumes the
// capability's Handler is the canonical entry point and reuses its dispatch
// by hand-building a minimal MCP request.
type miDeviceCaller struct {
	cap *mi.Capability
}

// NewMiDeviceCaller registers mi_device with the workflow registry.
// Pure-Go shim; no extra state beyond the underlying capability.
func NewMiDeviceCaller(reg *workflow.Registry) *miDeviceCaller {
	c := &miDeviceCaller{cap: mi.NewCapability()}
	reg.Register(c)
	return c
}

// Name returns "mi_device" matching the MCP tool name.
func (c *miDeviceCaller) Name() string { return "mi_device" }

// Call dispatches a mi action. arguments must include "action"; the rest
// maps onto mi.CapabilityRequest fields. The result mirrors the MCP
// handler's StructuredContent so brain filters can read the same shape.
func (c *miDeviceCaller) Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error) {
	body, err := json.Marshal(arguments)
	if err != nil {
		return nil, fmt.Errorf("miDeviceCaller: marshal: %w", err)
	}
	var req mi.CapabilityRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return nil, fmt.Errorf("miDeviceCaller: unmarshal: %w", err)
	}
	// mi.Dispatch takes (auth, request) and returns a map. We pass nil for
	// auth: actions that require it surface a clear AUTH_FAILED result.
	result := mi.Dispatch(nil, req)
	if status, _ := result["status"].(string); status == "error" {
		return result, fmt.Errorf("mi_device %s failed: %v", action, result["error"])
	}
	return result, nil
}

// adbCmdCaller wraps adb.Capability as a workflow tool. Same pattern as
// miDeviceCaller: the dispatch function on adb.Capability already returns
// a map; we surface it under the workflow contract.
type adbCmdCaller struct {
	cap *adb.Capability
}

// NewAdbCmdCaller registers adb_cmd with the workflow registry.
func NewAdbCmdCaller(reg *workflow.Registry) *adbCmdCaller {
	c := &adbCmdCaller{cap: adb.NewCapability()}
	reg.Register(c)
	return c
}

// Name returns "adb_cmd".
func (c *adbCmdCaller) Name() string { return "adb_cmd" }

// Call dispatches an adb action. arguments must include "action"; the rest
// maps onto adb.Request fields. The result is the map returned by
// adb.Capability.dispatch.
func (c *adbCmdCaller) Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error) {
	body, err := json.Marshal(arguments)
	if err != nil {
		return nil, fmt.Errorf("adbCmdCaller: marshal: %w", err)
	}
	var req adb.Request
	if err := json.Unmarshal(body, &req); err != nil {
		return nil, fmt.Errorf("adbCmdCaller: unmarshal: %w", err)
	}
	if req.Action == "" {
		req.Action = action
	}
	result := c.cap.Dispatch(req)
	if status, _ := result["status"].(string); status == "error" {
		return result, fmt.Errorf("adb_cmd %s failed: %v", action, result["error"])
	}
	return result, nil
}

// dlnaCaller wraps dlna.Capability as a workflow tool.
type dlnaCaller struct {
	cap *dlna.Capability
}

// NewDlnaCaller registers dlna_ctl with the workflow registry.
func NewDlnaCaller(reg *workflow.Registry) *dlnaCaller {
	c := &dlnaCaller{cap: dlna.NewCapability()}
	reg.Register(c)
	return c
}

// Name returns "dlna_ctl".
func (c *dlnaCaller) Name() string { return "dlna_ctl" }

// Call dispatches a DLNA action.
func (c *dlnaCaller) Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error) {
	var req dlna.Request
	if err := mapToStruct(arguments, &req); err != nil {
		return nil, fmt.Errorf("dlnaCaller: %w", err)
	}
	if req.Action == "" {
		req.Action = action
	}
	result := c.cap.Dispatch(req)
	if status, _ := result["status"].(string); status == "error" {
		return result, fmt.Errorf("dlna_ctl %s failed: %v", action, result["error"])
	}
	return result, nil
}

// bilibiliCaller wraps bilibili.Capability as a workflow tool.
type bilibiliCaller struct {
	cap *bilibili.Capability
}

// NewBilibiliCaller registers bilibili_ctl with the workflow registry.
func NewBilibiliCaller(reg *workflow.Registry) *bilibiliCaller {
	c := &bilibiliCaller{cap: bilibili.NewCapability()}
	reg.Register(c)
	return c
}

// Name returns "bilibili_ctl".
func (c *bilibiliCaller) Name() string { return "bilibili_ctl" }

// Call dispatches a Bilibili action.
func (c *bilibiliCaller) Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error) {
	var req bilibili.Request
	if err := mapToStruct(arguments, &req); err != nil {
		return nil, fmt.Errorf("bilibiliCaller: %w", err)
	}
	if req.Action == "" {
		req.Action = action
	}
	result := c.cap.Dispatch(req)
	if status, _ := result["status"].(string); status == "error" {
		return result, fmt.Errorf("bilibili_ctl %s failed: %v", action, result["error"])
	}
	return result, nil
}

// moonlightCaller wraps moonlight.Capability as a workflow tool.
type moonlightCaller struct {
	cap *moonlight.Capability
}

// NewMoonlightCaller registers moonlight_ctl with the workflow registry.
func NewMoonlightCaller(reg *workflow.Registry) *moonlightCaller {
	c := &moonlightCaller{cap: moonlight.NewCapability()}
	reg.Register(c)
	return c
}

// Name returns "moonlight_ctl".
func (c *moonlightCaller) Name() string { return "moonlight_ctl" }

// Call dispatches a Moonlight action.
func (c *moonlightCaller) Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error) {
	var req moonlight.Request
	if err := mapToStruct(arguments, &req); err != nil {
		return nil, fmt.Errorf("moonlightCaller: %w", err)
	}
	if req.Action == "" {
		req.Action = action
	}
	result := c.cap.Dispatch(req)
	if status, _ := result["status"].(string); status == "error" {
		return result, fmt.Errorf("moonlight_ctl %s failed: %v", action, result["error"])
	}
	return result, nil
}

// a11yCaller wraps a11y.Capability as a workflow tool.
type a11yCaller struct {
	cap *a11y.Capability
}

// NewA11yCaller registers a11y_ctl with the workflow registry.
func NewA11yCaller(reg *workflow.Registry) *a11yCaller {
	c := &a11yCaller{cap: a11y.NewCapability()}
	reg.Register(c)
	return c
}

// Name returns "a11y_ctl".
func (c *a11yCaller) Name() string { return "a11y_ctl" }

// Call dispatches an accessibility action.
func (c *a11yCaller) Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error) {
	var req a11y.Request
	if err := mapToStruct(arguments, &req); err != nil {
		return nil, fmt.Errorf("a11yCaller: %w", err)
	}
	if req.Action == "" {
		req.Action = action
	}
	result := c.cap.Dispatch(req)
	if status, _ := result["status"].(string); status == "error" {
		return result, fmt.Errorf("a11y_ctl %s failed: %v", action, result["error"])
	}
	return result, nil
}

// remoteDesktopCaller wraps remote_desktop.Capability as a workflow tool.
type remoteDesktopCaller struct {
	cap *remote_desktop.Capability
}

// NewRemoteDesktopCaller registers remote_desktop with the workflow registry.
func NewRemoteDesktopCaller(reg *workflow.Registry) *remoteDesktopCaller {
	c := &remoteDesktopCaller{cap: remote_desktop.NewCapability()}
	reg.Register(c)
	return c
}

// Name returns "remote_desktop".
func (c *remoteDesktopCaller) Name() string { return "remote_desktop" }

// Call dispatches a remote desktop action.
func (c *remoteDesktopCaller) Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error) {
	var req remote_desktop.Request
	if err := mapToStruct(arguments, &req); err != nil {
		return nil, fmt.Errorf("remoteDesktopCaller: %w", err)
	}
	if req.Action == "" {
		req.Action = action
	}
	result := c.cap.Dispatch(req)
	if status, _ := result["status"].(string); status == "error" {
		return result, fmt.Errorf("remote_desktop %s failed: %v", action, result["error"])
	}
	return result, nil
}

// mediaCaller wraps media.Capability as a workflow tool.
type mediaCaller struct {
	cap *media.Capability
}

// NewMediaCaller registers media_sniff with the workflow registry.
func NewMediaCaller(reg *workflow.Registry) *mediaCaller {
	c := &mediaCaller{cap: media.NewCapability()}
	reg.Register(c)
	return c
}

// Name returns "media_sniff".
func (c *mediaCaller) Name() string { return "media_sniff" }

// Call dispatches a media sniffing action.
func (c *mediaCaller) Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error) {
	var req media.Request
	if err := mapToStruct(arguments, &req); err != nil {
		return nil, fmt.Errorf("mediaCaller: %w", err)
	}
	if req.Action == "" {
		req.Action = action
	}
	result := c.cap.Dispatch(req)
	if status, _ := result["status"].(string); status == "error" {
		return result, fmt.Errorf("media_sniff %s failed: %v", action, result["error"])
	}
	return result, nil
}

// alistCaller wraps alist.Capability as a workflow tool.
type alistCaller struct {
	cap *alist.Capability
}

// NewAlistCaller registers netdisk_sync with the workflow registry.
func NewAlistCaller(reg *workflow.Registry) *alistCaller {
	c := &alistCaller{cap: alist.NewCapability()}
	reg.Register(c)
	return c
}

// Name returns "netdisk_sync".
func (c *alistCaller) Name() string { return "netdisk_sync" }

// Call dispatches a netdisk sync action.
func (c *alistCaller) Call(ctx context.Context, action string, arguments map[string]any) (map[string]any, error) {
	var req alist.CapabilityRequest
	if err := mapToStruct(arguments, &req); err != nil {
		return nil, fmt.Errorf("alistCaller: %w", err)
	}
	if req.Action == "" {
		req.Action = action
	}
	result := c.cap.Dispatch(req)
	if status, _ := result["status"].(string); status == "error" {
		return result, fmt.Errorf("netdisk_sync %s failed: %v", action, result["error"])
	}
	return result, nil
}

// RegisterAll wires every HomeSense tool the executor ships with into the
// workflow registry. Convenience for the common case where the executor
// exposes the full set of capabilities.
func RegisterAll(reg *workflow.Registry) {
	NewMiDeviceCaller(reg)
	NewAdbCmdCaller(reg)
	NewDlnaCaller(reg)
	NewBilibiliCaller(reg)
	NewMoonlightCaller(reg)
	NewA11yCaller(reg)
	NewRemoteDesktopCaller(reg)
	NewMediaCaller(reg)
	NewAlistCaller(reg)
}

// mapToStruct JSON-roundtrips a map into a typed struct. The map shape
// mirrors the MCP tool's Request/Args schema, so existing tool callers
// keep working without any change.
func mapToStruct(in map[string]any, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return fmt.Errorf("marshal: %w", err)
	}
	return json.Unmarshal(body, out)
}
