# ADB Targeting Skills

## Goal
把“想点哪个元素”转成稳定的点击动作。

## Preferred flow
1. 先拉取 `get_ui_tree`
2. 如果有文本目标，优先 `find_text`
3. 命中元素后取 `center`
4. 用 `click_element` 或 `tap` 执行

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
