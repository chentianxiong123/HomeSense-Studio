---
skill_id: adb.targeting
tool: adb
capabilities:
  - device.tv.ui.find_text
  - device.tv.ui.click_element
exposure_level: progressive
risk_level: low
preconditions:
  - tv_connection_available
  - ui_context_available
---

# ADB Targeting Skills

## Skill ID
`adb.targeting`

## Goal
把“想点哪个元素”转成稳定的点击动作。

## Capability focus (v0)
- `device.tv.ui.find_text`
- `device.tv.ui.click_element`

## Preferred flow
1. 先调用 `device.tv.ui.inspect.tree`
2. 如果有文本目标，优先 `device.tv.ui.find_text`
3. 命中元素后取 `center`
4. 再调用 `device.tv.ui.click_element`

## Current middle-grain actions
- `find_text(text)`
- `click_element(text)`
- `click_element(x, y)`

## When to stay at this level
适用于：
- 页面上有明确文本
- UI tree 可正常拿到 bounds / center
- 不需要视觉模型

## When to escalate
如果 UI tree 没有 text、bounds 不稳定、或元素是图标而不是文字，进入：
- `perception.md`
- `fallback.md`

## Exposure note
优先暴露 capability，不直接暴露低层 `tap/swipe` 给高层 planner。
