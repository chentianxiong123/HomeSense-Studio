---
name: device_skill.tv_box
description: "Operate Android TV, TV boxes, and set-top boxes through ADB, apps, remote keys, and UI observation."
device_type: tv_box
title: "电视盒 / 机顶盒"
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

# 电视盒 / 机顶盒

## When to load
- 看电视
- 打开应用
- 播放视频
- 返回首页
- 遥控操作
- 需要观察电视盒当前界面

## Progressive disclosure
1. 先从设备清单确认目标电视盒或机顶盒。
2. 如果只是遥控键，读取设备能力后映射到按键能力。
3. 如果要打开应用，先用 `list_device_apps` 查询包名，除非用户已经提供 package。
4. 如果需要点击或输入，先用 `take_screenshot` 或 `get_ui_tree` 观察界面。
5. 不确定时先 `rehearse_device_capability`，通过后再 `execute_device_capability`。

## Common paths
### 打开视频应用
- 确认目标设备。
- 查询应用包名。
- 沙箱演练 `adb.launch_app`。
- 真实执行 `adb.launch_app`。

### 遥控导航
- 确认目标设备。
- 读取设备能力。
- 映射返回、主页、确认、方向、音量等按键。
- 沙箱演练按键。
- 真实发送按键。

## Argument rules
- `adb.launch_app` 需要 `package`；不知道包名时先查询已安装应用。
- `adb.tap` 需要 `x` 和 `y`；坐标来自截图或 UI 树。
- `adb.input_text` 需要 `text`；输入前确认焦点在可输入区域。
- `adb.tap_element` 需要 `index` 或 `text`。

## Failure recovery
- 设备离线时先检查 ADB 连接。
- 应用启动失败时重新查询包名。
- 遥控无响应时尝试返回首页后重试。
