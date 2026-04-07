# ADB Skills Index

## Tool role
ADB 是 HomeSense 中负责安卓设备控制与界面操作的能力域。

## Middle-grain capabilities
- 获取当前界面结构
- 打开应用
- 查找文本位置
- 点击界面元素
- 页面返回 / 回主页
- 截图与界面理解兜底

## Progressive disclosure
不要一次性展开所有内部能力。优先只暴露中粒度能力；在需要时再进入：
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
