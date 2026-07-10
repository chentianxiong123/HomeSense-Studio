# Rule Engine Skills Index

## Tool role
rule_engine 是 HomeSense 的精准匹配层，负责把稳定、可复用的触发语句快速命中成响应或动作。

## What it is good at
- 完全匹配
- 同义词扩展后的精准匹配
- 快速返回 response
- 直接返回已知 actions

## What it is not for
- 不负责复杂语义理解
- 不负责首次复杂问题求解
- 不负责模糊指代补全

## Progressive disclosure
按需展开：
- `matching.md`：匹配与命中规则
- `authoring.md`：如何编写适合提升为规则的内容
- `limitations.md`：什么时候不该继续强塞进规则层
