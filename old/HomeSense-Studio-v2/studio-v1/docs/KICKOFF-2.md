# 开工提示词（第三轮）

复制以下内容作为新会话的第一条消息：

---

## 背景

我是 HomeSense Studio 的开发者。这是一个 LLM-first 智能家居 Agent 平台，已完成框架搭建和 L2 自增强闭环。

项目位置：`D:\files\HomeSense-Stdio`

技术栈：Node.js + Fastify + Vue 3 + SQLite + LangGraph。外部依赖 bilibili-music（Python FastAPI，投屏/音乐/音箱）。

## 当前状态

L2 自增强闭环已打通：执行成功 → 持久化 → 编译 �� 向量化 → 召回 → 执行。视觉层接通真实 provider。Workflow 有 19 种节点类型。前端编辑器使用 Vue Flow。

## 已完成（第二轮）

- L2 召回链路：embedding 激活 + rerank + intent fingerprint + 系统工具 + 闭环反馈
- L2 写入侧修复：path candidate 持久化 + knowledge compiler 编译经验路径
- 视觉层：真实 vision provider (doubao-seed-1.6-flash) + OpenCV 模板缓存
- 音箱登录 UI：集成页小米账号 QR 登录面板
- 旧模块清理：删除 a2a-client，禁用 devtest
- Workflow 节点扩展：wait_until、http_request、human_input
- graph.test.ts 修复：上下文裁剪策略对齐
- seedDefaultProviders 修复：强制更新旧 provider key

## 没做完的事（按优先级）

1. **视觉层深化**：把 screen-understand 的结果写入 graph_nodes/edges，构建 UI 导航地图（记忆宫殿）
2. **端到端测试**：验证 L2 自增强闭环完整跑通（发消息 → 执行 → 确认 → 路径存储 → 再发 → fingerprint 命中）
3. **Workflow human_input 真正暂停**：当前是同步返回，需要支持暂停等待用户输入后继续
4. **更新 docs/STATUS.md**：反映当前进度
5. **Workflow 前端完善**：运行历史页面、实时状态推送

## 关键文件

- 入口：`packages/backend/src/app.ts`
- Chat 图：`packages/backend/src/modules/chat/graph.ts`
- Chat 路由（路径持久化）：`packages/backend/src/modules/chat/routes.ts`
- Intent fingerprint：`packages/backend/src/modules/intent-fingerprint/index.ts`
- 系统工具：`packages/backend/src/modules/system-tools/index.ts`
- 知识编译器：`packages/backend/src/modules/knowledge-compiler/index.ts`
- 视觉层：`packages/backend/src/modules/screen-understand/index.ts`
- OpenCV 模板缓存：`packages/backend/src/modules/vision-tools/opencv.ts`
- Workflow 节点定义：`packages/backend/src/modules/workflow/node-definitions.ts`
- Workflow 节点实现：`packages/backend/src/modules/workflow/built-in-nodes.ts`
- Workflow 节点工厂：`packages/backend/src/modules/workflow/node-factory.ts`
- 前端编辑器：`packages/frontend/src/views/StudioView.vue`
- 前端集成页：`packages/frontend/src/views/IntegrationsView.vue`
- LLM Provider seed：`packages/backend/src/modules/llm-provider/service.ts` (seedDefaultProviders)
- 交接文档：`docs/HANDOFF-2.md`
- 设计文档：`docs/design/` 下 6 份

## 构建命令

```bash
npm run -w backend build && npm run -w backend test
npm run -w frontend build && npm run -w frontend test
```

## 你需要做的

先读 `docs/HANDOFF-2.md` 了解全貌。然后从上面 5 个未完成项中选一个开始做。每做一个改动都要跑测试验证。

不要重写已有模块，而是在现有骨架上补血肉。保持代码风格一致。

---
