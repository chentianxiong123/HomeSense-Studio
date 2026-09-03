# 2026-05-26 · LLM 管理页面 + 后端 category 分类

> ✅ 完成 | 前后端 + DB

## 探索成果
- llm_providers 表加 category 列（chat/embedding/rerank）
- listProviders(category?) 按类型过滤，setDefault 仅清除同类型默认
- 导航栏新增「模型」tab，三标签页分类展示
- 每类模型独立设置当前使用，互不干扰
- 添加/编辑/删除/设当前 provider 完整 CRUD

## 技术栈
- SQLite 列迁移（ALTER TABLE ADD COLUMN）
- 每类仅允许一个 is_default（setDefault 自动清除同类）
- 卡片式布局，复用现有主题风格

## 关键决策
- 三类模型各存多个 provider，手动设当前使用 → 不自动切换，用户可控
- 前端按 category 过滤，后端 listProviders(category?) 支持 → 职责清晰

文件: ~db/index.ts · ~service.ts · ~routes.ts · +LLMView.vue · ~App.vue · ~router/index.ts · ~api/index.ts