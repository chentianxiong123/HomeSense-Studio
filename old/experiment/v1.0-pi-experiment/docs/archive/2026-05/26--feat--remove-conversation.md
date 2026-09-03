# 2026-05-26 · 移除会话概念 + 去会话化

> ✅ 完成 | 后端全链路 + 前端 UI

## 探索成果
- 移除 conversations 表依赖，消息平铺存储，不再分「会话」
- repository.ts 精简：删 createConversation、conversation_id 过滤、getLatestConversation、hasOlderConversations
- service.ts/routes.ts 同步简化：stream 端点不再需要 conversation_id
- 前端 onMounted 改为 `GET /api/chat/messages?direction=latest&limit=50` 加载最近消息
- CSS 居中：消息区和输入框 max-width: 800px、flex-shrink: 0 防止 header/input 被压缩
- ` thinking` 存库修复：regex 补未闭合标签兜底 `.replace(/ thinking[\s\S]*/g, '')`
- 清理 7 条旧 ` thinking` 脏数据

## 技术栈
- 纯游标分页（无会话过滤）
- 平铺消息列表（direction=latest 倒序取最近 N 条）
- scrollHeight 差值补偿保持滚动位置

## 关键决策
- 不分会话 → 单用户助手场景，降低复杂度
- 以后分库可以，分会话没必要 → 数据分组在 DB 层做，不给前端暴露

文件: ~chat/repository.ts · ~chat/service.ts · ~chat/routes.ts · ~ChatView.vue