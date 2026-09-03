# LLM Agent Skills Index

## Tool role
llm_agent 是 HomeSense 的 Deep Layer 入口，负责首次复杂问题求解、结构化规划、候选动作生成，以及后续的多步 agent 演进。

## What it is good at
- 首次复杂任务理解
- 结构化 plan
- suggested_actions
- 结合上下文与经验层做深层决策

## What it is not yet
- 当前仍是最小结构化 planner
- 尚未完全接入真实多步大模型循环

## Progressive disclosure
按需展开：
- `planning.md`
- `tooling.md`
- `writeback.md`
