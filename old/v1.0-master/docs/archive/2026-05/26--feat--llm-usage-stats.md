# 2026-05-26 · LLM 用量统计全链路埋点

> ✅ 完成 | 后端 service + DB + API + 前端统计页

## 探索成果
- llmService 四个方法（chat/chatStream/embed/rerank）全部埋点，覆盖 13 个调用点
- chatStream 拆成 wrapper + _chatStreamInner，消费完后自动 recordUsage
- 加 stream_options: { include_usage: true } 促使 OpenAI 兼容接口返��� usage
- 新增 llm_usage_log 表 + 2 索引（created_at / provider_id）
- 新增 GET /api/llm/usage 分页日志 + GET /api/llm/usage/totals 聚合统计
- 前端 LLMView 新增「使用统计」tab：日期筛选 + 汇总卡片 + 按 provider/model 分组 + 调用日志表
- recordUsage 全程 try/catch，用量记录失败不影响正常 LLM 调用

## 技术栈
- llmService 内部埋点（所有调用方零改动）
- AsyncGenerator wrapper 模式（chatStream 延迟记录）
- SQLite 聚合查询（GROUP BY provider/model/category）
- URLSearchParams 构建查询参数

## 关键决策
- 埋点在 llmService 内部而非 routes.ts → 13 个调用点全覆盖（含 agent-runtime、workflow、memory-kernel）
- chatStream 用 wrapper 而非修改 inner generator → 调用方接口不变
- recordUsage 永不抛异常 → 用量记录是附加功能，不能影响主流程
- 按 provider + model 双维度统计 → provider 看大盘，model 看细分成本

文件: +llm_usage_log（DB 表） · ~llm-provider/service.ts · ~llm-provider/routes.ts · ~api/index.ts · ~LLMView.vue · ~db/index.ts
