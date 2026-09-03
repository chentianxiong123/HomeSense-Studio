# Rule Engine Matching Skills

## Goal
以最低成本命中已经沉淀成熟的表达。

## Current behavior
1. 读取 rules
2. 做同义词扩展
3. 用 trigger 精准查找
4. 返回 response / actions

## Best fit
- 触发语句稳定
- 动作固定
- 已多次复用
- 值得变成缓存层第一优先级

## Escalation
如果未命中或命中代价太高，应继续进入：
- `local_intent`
- `success_paths`
- `llm_agent`
