---
name: device_skill.phone
description: "Operate Android phones through ADB observation, app launch, input, tap, swipe, and screenshots."
device_type: phone
title: "手机"
status: active
load_policy: on_device_type_match
allowed_tools:
  - get_device_capabilities
  - list_device_apps
  - get_current_app
  - take_screenshot
  - get_ui_tree
  - rehearse_device_capability
  - execute_device_capability
context_mode: inline
---

# 手机

## When to load
- 打开手机应用
- 点击手机
- 输入文字
- 查看当前界面
- 需要手机截图或 UI 树

## Progressive disclosure
1. 先确认目标手机。
2. 对应用类任务，优先查询当前应用或应用列表。
3. 对界面操作任务，先观察截图或 UI 树，再决定点击、滑动或输入。
4. 对有参数的能力，补齐参数后先沙箱演练。
5. 演练通过后再真实执行。

## Common paths
### 打开应用并操作
- 确认手机设备。
- 查询应用包名或当前应用。
- 观察界面。
- 沙箱演练操作。
- 真实执行。

## Argument rules
- `adb.launch_app` 需要 `package`。
- `adb.tap` 需要 `x` 和 `y`。
- `adb.input_text` 需要 `text`。
- `adb.swipe` 需要起点、终点和可选 `duration`。

## Failure recovery
- ADB 未连接时先检查连接。
- 点击失败时重新截图确认界面。
- 输入失败时检查当前焦点。
