# 2026-05-25 · Chat2 后端模块搭建

> ✅ 完成 | 后端 + DB

## 探索成果
- 创建 chat2 模块（repository.ts + service.ts + routes.ts）
- 独立 chat.db（SQLite WAL）
- 三个端点：GET /api/chat2/messages（游标分页）、POST /api/chat2/message、POST /api/chat2/stream
- 游标分页 API 测通（cursor_id + direction）
- SSE 已测通（placeholder 回复，等 LLM 接入）

## 技术栈
- SQLite WAL 模式（独立 chat.db）
- 游标分页（基于 message id，不用 OFFSET）
- SSE（text/event-stream）
- 纯聊天，不走 agent runtime

## 关键决策
- 游标分页不用 OFFSET → 性能更好，支持双向滚动
- 独立 chat.db → 聊天数据与业务数据隔离

文件: +modules/chat2/repository.ts · +modules/chat2/service.ts · +modules/chat2/routes.ts