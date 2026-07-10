# Rule Engine Limitations Skills

## Do not overuse the rule layer
规则层应该快、稳、窄。

## Signs a task should leave the rule layer
- 需要理解“它 / 那个设备”
- 需要从最近上下文补全目标
- 需要视觉识别页面
- 需要规划多步操作
- 需要处理全新问题

## Preferred handoff
- 模糊语义 -> `local_intent`
- 经验复用 -> `success_paths`
- 首次复杂问题 -> `llm_agent`
