# LLM 管理模块实现方案

## 总览
- 后端：llm_providers 加 category 字段，支持按类型过滤
- 前端：新 LLMView.vue 页面，三个子面板
- 导航：App.vue 加「模型」tab

## 后端（Stream A）
1. db/index.ts: ALTER TABLE llm_providers ADD category
2. service.ts: ProviderRow 加 category，listProviders 支持 category 过滤
3. routes.ts: addProvider 接收 category，增 GET ?category= 参数
4. setDefault 仅清除同 category 的 is_default

## 前端（Stream B）
1. router/index.ts: 加 /llm 路由
2. App.vue: navItems 加「模型」tab
3. api/index.ts: 加 llmProviders CRUD 方法
4. LLMView.vue: 三个标签页（对话/嵌入/重排序），每页 provider 列表