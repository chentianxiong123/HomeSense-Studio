# 2026-05-26 · Chat 模块换血 + 真实 LLM 流式对话

> ✅ 完成 | 前后端 + DB + LLM 流式

## 探索成果
- 老 chat/conversation 废弃，chat2 晋升为主力模块
- SSE 流式对话接入真实 LLM（minimax-m2.7），零新增 TS 错误
- repository.ts 新增 conversations 表 + createConversation + addMessage
- 前端 ChatView.vue 删 mock，接真实 SSE，带 currentConversationId
- 思考链 SSE 实时展示，存库前自动去除
- agent-runtime HistoryItem 内联（原依赖 conversation 模块已删）
- executor-gateway 动态 import 解循环依赖 TDZ
- SQLite  ALTER TABLE 迁移：messages 加 conversation_id 列

## 技术栈
- llmService.chatStream（AsyncGenerator delta 流）
- SSE（text/event-stream + ReadableStream 前端消费）
- 游标分页（基于 message id）
- 动态 import（解循环依赖）
- SQLite 列迁移

## 关键决策
- 思考链不存 DB → DB 干净，前端流式展示不丢
- 路由重命名：/api/chat2/* → /api/chat/* → 统一命名
- 动态 import 解 TDZ → workflowRuntime 改为 initialize() 里动态加载

文件: -modules/chat/ · -modules/conversation/ · -demo-standalone-chat.ts · +modules/chat/ · ~app.ts · ~ChatView.vue · ~routes.ts · ~repository.ts · ~events.ts · ~index.ts