---
skill_id: context_completer.context
tool: context_completer
keywords:
  - 补全
  - 设备
  - 上下文
  - 代词
exposure_level: summary
---

# 上下文设备补全

## 功能
根据历史对话中的设备提及权重，自动补全用户输入中的设备信息。

## 规则
1. 代词替换: "它"、"那个"、"这个" → 替换为最近提及的设备
2. 触发词补全: "看B站" → "在东芝电视上看B站"
3. 设备权重: 最近20条消息中，越近的设备权重越高
