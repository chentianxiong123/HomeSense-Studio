# 开工提示词

复制以下内容作为新会话的第一条消息：

---

## 背景

我是 HomeSense Studio 的开发者。这是一个 LLM-first 智能家居 Agent 平台，已完成整体框架搭建。

项目位置：`D:\files\HomeSense-Stdio`

技术栈：Node.js + Fastify + Vue 3 + SQLite + LangGraph。外部依赖 bilibili-music（Python FastAPI，投屏/音乐/音箱）。

## 当前状态

框架已通，链路已连，但很多模块是"骨架"而非"血肉"：

- **Chat 运行时**：LLM 主体 + 工具调用 + 沙箱演练 + SSE 流式，能跑
- **Workflow 运行时**：节点编排 + 设备能力 + 子流程 + 运行证据，能跑
- **设备管理**：真实设备注册 + 能力注册 + 在线检测 + 卡片投影，能跑
- **外部集成**：bilibili-music 已登记为外部能力源，DLNA 投屏 + 音箱投屏 CLI 已接入
- **记忆资产**：经验路径、用户反馈、设备偏好，DB 表和 API 已通
- **Skills 系统**：设备类型 skill + 通用 skill + 渐进式披露，能跑

## 没做完的事（按优先级）

1. **L2 召回链路**：embedding 写入 + rerank 排序 + candidate-plan 融合，目前只有接口没有真实数据流
2. **多模态视觉**：vision-tools / screen-understand 只有 stub，需要接真实 vision provider
3. **bilibili-music 音箱登录**：speaker 模块需要小米账号登录才能用，集成页还没暴露登录入口
4. **旧模块清理**：agent-adapter / a2a-client / devtest 有历史残留
5. **graph.test.ts 修复**：上下文裁剪策略与测试断言不一致

## 关键文件

- 入口：`packages/backend/src/app.ts`
- Chat 图：`packages/backend/src/modules/chat/graph.ts`
- 设备能力：`packages/backend/src/modules/device/device-capability-registry.ts`
- 外部集成：`packages/backend/src/modules/external-integrations/index.ts`
- 投屏桥接：`packages/bilibili-cast-bridge/src/index.mjs`
- 能力地图：`packages/backend/src/modules/runtime-capability-map/index.ts`
- 前端集成页：`packages/frontend/src/views/IntegrationsView.vue`
- 状态文档：`docs/STATUS.md`
- 交接文档：`docs/HANDOFF.md`
- 设计文档：`docs/design/` 下 6 份

## 构建命令

```bash
npm run -w backend build && npm run -w backend test
npm run -w frontend build && npm run -w frontend test
```

## 你需要做的

先读 `docs/HANDOFF.md` 了解全貌，再读 `docs/STATUS.md` 了解已完成清单。然后从上面 5 个未完成项中选一个开始做。每做一个改动都要跑测试验证。

不要重写已有模块，而是在现有骨架上补血肉。保持代码风格一致。

---
