---
name: device_skill.computer
description: "Computer device strategy focused on presence, online state, and future remote automation bindings."
device_type: computer
title: "电脑"
status: draft
load_policy: on_device_type_match
allowed_tools:
  - get_device_capabilities
  - rehearse_device_capability
context_mode: inline
---

# 电脑

## When to load
- 电脑在线吗
- 操作电脑
- 打开电脑应用
- 检查电脑状态

## Progressive disclosure
1. 先确认目标电脑。
2. 优先使用设备卡片里的在线状态。
3. 如果没有执行绑定，只说明当前状态，不假装可以操作。
4. 如果未来接入 ADB、CLI、远程桌面或 MCP，再按能力加载执行说明。

## Common paths
### 检查电脑状态
- 确认电脑设备。
- 检查在线状态。
- 读取可用能力。
- 没有绑定时只回答状态。

## Argument rules
- `status_check` 优先使用设备卡片里的 network 状态。

## Failure recovery
- 没有执行绑定时只做状态说明，不假装可操作。
