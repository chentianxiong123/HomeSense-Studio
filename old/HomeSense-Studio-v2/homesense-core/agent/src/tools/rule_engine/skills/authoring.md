# Rule Engine Authoring Skills

## When to promote into a rule
优先考虑：
- 复用次数高
- 成功率高
- 动作序列稳定
- 没有复杂上下文依赖

## Good rule examples
- 返回
- 主页
- 打开机顶盒
- 打开电视

## Avoid promoting too early
以下场景更适合停留在 success_paths 或 llm 层：
- 首次问题
- 需要深层上下文理解
- 依赖视觉判断的复杂页面
- 跨设备动态流程
