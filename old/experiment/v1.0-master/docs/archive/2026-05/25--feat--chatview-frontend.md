# 2026-05-25 · ChatView 前端组件

> ✅ 完成 | 前端

## 探索成果
- 创建 ChatView.vue：消息气泡（用户右/助手左）
- 普通滚动 + 触顶加载历史
- Enter 发送，Shift+Enter 换行
- 页面加载时自动恢复最近会话

## 技术栈
- Vue 3 Composition API
- 普通滚动（不用虚拟滚动）
- SSE 占位（等后端 LLM 接入）

## 关键决策
- 普通滚动不用虚拟滚动 → 移动端兼容，实现简单
- 触顶加载历史 → 游标分页，不预加载全部历史

文件: +ChatView.vue · ~router/index.ts