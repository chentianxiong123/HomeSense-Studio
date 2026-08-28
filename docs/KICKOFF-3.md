# 开工提示词（第四轮）

复制以下内容作为新会话第一条消息：

---

我是 HomeSense Studio 的开发者。请继续 `D:\files\HomeSense-Stdio` 项目的开发。

当前分支是：

```text
feat/nestjs-migration
```

项目背景：

- HomeSense Studio 是一个 LLM-first 智能家居 Agent / Studio 平台。
- Chat 是智能助手入口，Workflow 是独立可视化编排工作台，二者共享底层能力但不要混成一个系统。
- 当前架构方向是从散乱 Fastify routes 迁移到 NestJS 语义模块。
- Fastify 旧入口暂时保留为兼容层。
- 不再让 `mi-cli` / `adb-cli` / `bilibili-cli` 成为主干；CLI 只作为兼容适配层，未来米家、ADB、B站等逐步原生化。
- 不要造假数据；验证尽量走真实 DB、真实 API、真实路由。涉及真实设备动作时只做非破坏性验证。
- 不要乱删旧代码，替换时归档到 `_archive/`。
- 每次动手前请简洁报告你要做什么。

已完成并推送：

- `cc8d21d feat(nestjs): migrate device context and user-device modules`
- `cc152aa feat(nestjs): expose external integrations module`

当前未提交 WIP：

- `packages/backend/src/nest/modules/executor-gateway/`
- `packages/backend/src/nest/app.module.ts`
- `packages/backend/src/modules/executor-gateway/index.ts`

当前卡点：

`executor-gateway` 试迁移到 Nest 后，Nest pilot 启动失败：

```text
ReferenceError: Cannot access 'defaultCandidatePlanService' before initialization
at new IntentRouterService (.../modules/intent/router.js)
```

判断：

- 不是 Nest controller 本身的问题。
- 是 `executor-gateway/index.ts` 顶层导入旧聚合入口导致的 ESM 循环依赖。
- 重点检查：
  - `import ... from '../plan/index.js'`
  - `import ... from '../memory/index.js'`

下一步任务：

1. 先不要提交当前 WIP。
2. 修 `executor-gateway/index.ts` 的导入边界：
   - plan 只从 `../plan/library.js` 导入。
   - memory 只从 `../memory/kernel.js` 导入。
   - 避免聚合入口 `../plan/index.js`、`../memory/index.js`。
3. 保留 `workflow/run-workflow` 懒加载，只在执行 `workflow.run` 时 import。
4. 跑验证：
   - `cd packages/backend && npx tsc --noEmit`
   - `npx vitest run src/nest/modules/user-device/user-device.service.test.ts`
   - Nest pilot smoke：`/api/health`、`/api/executor-gateway/executors`、`/api/executor-gateway/plans`
5. smoke 通过后提交并推送：
   - `feat(nestjs): expose executor gateway module`

继续推进时要快一点，但不要发散。当前重点是把 NestJS 模块边界打全，而不是重写业务细节。
