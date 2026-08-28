# LLM Agent Write-back Skills

## Goal
Deep Layer 成功或失败后，不浪费这次求解成本，要把经验沉淀回系统。

## Current write-back targets
- success_paths
- execution_summary
- rule_candidate
- user_visible_reflection

## Principle
第一次复杂问题由 LLM 解决，后面尽量把成功经验沉淀成更快的缓存层。

## Future direction
- 更细的经验结构
- 更智能的规则候选
- 与 success_paths / retrieval 更紧密联动
