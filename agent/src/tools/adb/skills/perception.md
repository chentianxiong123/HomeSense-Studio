---
skill_id: adb.perception
tool: adb
capabilities:
  - device.tv.ui.inspect.tree
  - device.tv.ui.inspect.screenshot
exposure_level: progressive
risk_level: low
preconditions:
  - tv_connection_available
---

# ADB Perception Skills

## Skill ID
`adb.perception`

## Goal
理解当前设备界面，给 targeting 和 fallback 提供基础信息。

## Capability focus (v0)
- `device.tv.ui.inspect.tree`
- `device.tv.ui.inspect.screenshot`
- future: `device.tv.ui.inspect.ocr`
- future: `device.tv.ui.inspect.multimodal`

## Current available sources
- `get_ui_tree`：结构化界面元素
- `screenshot`：当前屏幕截图

## Current strategy
默认优先：
1. UI tree
2. OCR（未来）
3. 多模态（未来）

## Device differences
- 手机界面通常更适合 UI tree
- 电视界面经常缺 text，需要更强感知

## Future providers
### OCR
- local OCR
- OCR API

### Multimodal
- 截图理解
- 与 UI tree 联合判断
- 用于图标、无文本按钮、复杂页面

## Exposure note
perception 应作为按需展开的 skill，而不是默认暴露全部视觉细节。
