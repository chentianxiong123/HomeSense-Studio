# ADB Fallback Skills

## Goal
当中粒度 targeting 失败时，提供逐级兜底路径，而不是一次性把所有细节暴露给上层。

## Fallback ladder
1. `get_ui_tree`
2. `find_text`
3. `click_element`
4. `screenshot`
5. OCR provider（未来）
6. 多模态理解（未来）

## Typical failure cases
- UI tree 没有 text
- 元素只有图标，没有文本标签
- bounds 不可靠
- 页面还没完全加载

## Future escalation policy
- 对有文字的目标，优先 OCR
- 对图标/复杂布局，优先多模态
- 保留 `strategy` / `perception` 配置决定顺序

## Important principle
上层系统不需要一次性知道所有内部 fallback 细节；只需要知道 ADB 有“界面理解与兜底能力”。更细的策略按需展开。
