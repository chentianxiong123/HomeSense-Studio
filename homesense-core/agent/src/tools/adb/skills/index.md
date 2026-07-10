---
skill_id: adb.index
tool: adb
capabilities:
  - device.tv.navigate.back
  - device.tv.navigate.home
  - device.tv.app.open
  - device.tv.ui.inspect.tree
  - device.tv.ui.inspect.screenshot
  - device.tv.ui.find_text
  - device.tv.ui.click_element
exposure_level: default
risk_level: low
preconditions:
  - tv_connection_available
---

# ADB Skills Index

## Skill ID
`adb.index`

## Tool role
ADB 是 HomeSense 中负责安卓设备控制与界面操作的能力域。

## Capability surface (v0)
- `device.tv.navigate.back`
- `device.tv.navigate.home`
- `device.tv.app.open`
- `device.tv.ui.inspect.tree`
- `device.tv.ui.inspect.screenshot`
- `device.tv.ui.find_text`
- `device.tv.ui.click_element`

## Exposure policy
- 默认只暴露中粒度 capability
- 不默认暴露低层坐标操作和内部 fallback 细节
- 只有在上层 capability 无法满足时，才进一步展开 targeting / perception / fallback

## Progressive disclosure
不要一次性展开所有内部能力。优先只暴露中粒度 capability；在需要时再进入：
- `targeting.md`：如何定位并点击元素
- `perception.md`：如何理解界面结构与视觉信息
- `fallback.md`：UI tree 不足时如何逐级兜底

## Current implementation status
当前已可用：
- `get_ui_tree`
- `find_text`
- `click_element`
- `open_app`
- `back`
- `home`
- `screenshot`

当前仍是后续扩展位：
- OCR provider
- 多模态 provider
- 图标定位
- 更复杂的页面恢复策略

## Mapping note
本 skill 以后应围绕 capability 暴露，而不是围绕底层 Python action 名称暴露。
