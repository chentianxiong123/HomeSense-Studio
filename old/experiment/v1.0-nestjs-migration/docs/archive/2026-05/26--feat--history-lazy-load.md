# 2026-05-26 · 前端历史消息懒加载

> ✅ 完成 | 前后端游标分页全链路

## 探索成果
- repository.ts listMessages + computePageInfo 加 conversationId 过滤参数
- service.ts getMessages 透传 conversationId
- routes.ts GET /api/chat/messages 支持 conversation_id 查询参数
- ChatView.vue onScroll 触顶自动加载更早 20 条消息
- 加载完保持滚动位置不跳（scrollTop = scrollHeight 差值补偿）
- hasOlder 状态追踪 + "到底了" 提示 + loadingOlder 加载指示器

## 技术栈
- 游标分页（基于 message id，direction=older）
- conversation_id 过滤（SQL AND 子句）
- scrollHeight 差值补偿（prepend 后保持视口位置）
- nextTick 确保 DOM 更新后再调整 scrollTop

## 关键决策
- 按 conversation_id 过滤 → 不同会话消息不混在一起
- hasOlder 初始值 = messages.length >= 20 → conversations/latest 返回全量，20 条为阈值
- prepend + scrollHeight 补偿 → 用户无感加载，不跳动

文件: ~chat/repository.ts · ~chat/service.ts · ~chat/routes.ts · ~ChatView.vue
