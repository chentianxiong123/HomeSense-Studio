# HomeSense Studio - 交接文档（第三轮）
> 2026-06-02 | Branch: `feat/nestjs-migration` | Latest pushed commit: `cc152aa`

## 背景定位

HomeSense Studio 当前定位是一个 **LLM-first 智能家居 Agent / Studio 平台**。

产品不是单纯命令执行器。Chat 是随性智能助手入口，Workflow 是独立的可视化编排工作台，二者共享底层能力、设备管理、外部集成、LLM Provider、记忆/Skill 系统，但不应强行混在一起。

近期架构方向已经明确：

- 后端从散乱 Fastify routes 逐步迁到 NestJS 语义模块。
- Fastify 旧入口暂时保留为兼容层，不直接删除。
- 不再把 `mi-cli` / `adb-cli` / `bilibili-cli` 当长期主干；CLI 只保留为兼容适配层。
- 米家、ADB、B站、SSH、串流、文件系统、消息网关等能力以后尽量走项目内聚合的原生模块或清晰外部集成。
- 数据库继续保持轻量化嵌入式方向，但必须按领域拆清楚，避免全局耦合。
- 不造假数据。验证优先走真实 DB、真实 API、真实路由；涉及设备动作时只做非破坏性验证。

## 已完成并推送

当前分支：`feat/nestjs-migration`

已推送到：

- GitHub: `github/feat/nestjs-migration`
- Gitee: `origin/feat/nestjs-migration`

近期关键提交：

| Commit | 内容 |
| --- | --- |
| `eb89b17` | NestJS skeleton with Fastify adapter |
| `641f5f3` | setting module migrated to NestJS |
| `b5c565b` | device-discovery module with native adbkit / miio + CLI compat fallback |
| `cc8d21d` | room/context/user-device migrated into NestJS path |
| `cc152aa` | external integrations exposed through NestJS |

## 第三轮已完成内容

### 1. NestJS user-device / room / context

已提交：`cc8d21d`

改动概要：

- `packages/backend/src/nest/modules/user-device/`
- `packages/backend/src/nest/modules/room/`
- `packages/backend/src/nest/modules/context/`
- `packages/backend/src/modules/device/user-device-routes.ts` 被瘦身为兼容转发。
- 旧 room/context route 实现归档到：
  - `packages/backend/src/_archive/2026-06-02-nestjs-migration/device-routes/`

user-device 已拆分为：

- `user-device-crud.service.ts`
- `user-device-capability.service.ts`
- `user-device-app.service.ts`
- `user-device-facade.ts`

Nest user-device 已暴露：

- `/api/user-devices`
- `/api/user-devices/cards`
- `/api/user-devices/runtime-manifest`
- `/api/user-devices/ping-all`
- `/api/user-devices/mi-candidates`
- `/api/user-devices/:id/capabilities`
- `/api/user-devices/:id/capabilities/execute`
- `/api/user-devices/:id/ir-keys`
- `/api/user-devices/:id/ir-press`
- `/api/user-devices/:id/capabilities/history`
- `/api/user-devices/:id/apps`
- `/api/user-devices/:id/apps/launch`

验证：

- `npx tsc --noEmit` 通过。
- `npx vitest run src/nest/modules/user-device/user-device.service.test.ts`，10/10 通过。
- Nest pilot smoke 使用真实 DB：读到 6 个设备。
- 动态能力 smoke 使用不存在设备 id，只验证真实 DB 路由，不触发实际设备动作。

### 2. NestJS external integrations

已提交：`cc152aa`

新增：

- `packages/backend/src/nest/modules/integration/integration.controller.ts`
- `packages/backend/src/nest/modules/integration/integration.service.ts`
- `packages/backend/src/nest/modules/integration/integration.module.ts`

Nest 已暴露：

- `/api/external-integrations`
- `POST /api/external-integrations`
- `DELETE /api/external-integrations/:id`

验证：

- Nest pilot smoke 使用真实 `external_integrations` 表。
- 返回 7 个默认登记项：
  - `bilibili-cli`
  - `bilibili-music`
  - `code-server-workspace`
  - `filesystem-gateway`
  - `message-gateway`
  - `moonlight-web-runtime`
  - `terminal-ssh-gateway`

## 当前未提交 WIP

用户要求继续推进后，开始试迁移 `executor-gateway` 到 NestJS，但尚未提交。

当前工作区包含：

- 修改：`packages/backend/src/modules/executor-gateway/index.ts`
- 修改：`packages/backend/src/nest/app.module.ts`
- 新增：`packages/backend/src/nest/modules/executor-gateway/`

WIP 内容：

- 新增 Nest executor-gateway controller/service/module。
- AppModule 注册 `ExecutorGatewayModule`。
- 将 `ExecutorGatewayService.initialize()` 里的 `workflow/run-workflow` 启动期 import 改成执行 `workflow.run` 时懒加载。

当前卡点：

Nest pilot 启动仍然失败，错误是旧模块循环依赖：

```text
ReferenceError: Cannot access 'defaultCandidatePlanService' before initialization
at new IntentRouterService (.../modules/intent/router.js)
```

判断：

- 问题不是 Nest controller 本身。
- 问题来自 `executor-gateway/index.ts` 顶层从聚合入口导入旧单例：
  - `../plan/index.js`
  - `../memory/index.js`
- 这些聚合入口会加载 candidate/assets 等模块，进一步绕回 intent/router/executor，形成 ESM 初始化循环。

建议下一步修法：

1. 不提交当前 WIP，先修干净。
2. 将 `executor-gateway/index.ts` 的聚合导入拆成精确子模块导入：
   - `../plan/library.js`
   - `../memory/kernel.js`
   - 避免 `../plan/index.js`
   - 避免 `../memory/index.js`
3. 重新跑：
   - `cd packages/backend && npx tsc --noEmit`
   - `npx vitest run src/nest/modules/user-device/user-device.service.test.ts`
   - Nest pilot smoke: `/api/health`, `/api/executor-gateway/executors`, `/api/executor-gateway/plans`
4. smoke 通过后再提交：
   - `feat(nestjs): expose executor gateway module`

## 重要原则

- 不要把 Chat 和 Workflow 混成一个系统。它们共享底层能力，但产品入口独立。
- Chat 是 LLM-first agent 助手。
- Workflow 是 Studio 的固化、可视化、可调试编排。
- L1/L2/L3 是 Chat 的执行层思想，不应强行套到 Workflow。
- Skill 是给 LLM 渐进式阅读的说明书/能力文档，不是 L2 的打分对象。
- 设备管理是锚点。真实设备、房间、在线状态、能力 JSON、上下文设备都应从设备管理抽象出来。
- CLI 兼容层可以保留，但不要继续让 CLI 名称污染主业务语义。
- 旧代码不要直接删除，替换时归档到 `_archive/`。
- 不要造 mock 当真实验证。
- 不要乱杀进程。smoke 用新端口，结束自己启动的进程。

## 建议路线

短期目标不是做完所有功能，而是把全图框架链路打通：

1. 完成 `executor-gateway` Nest 迁移。
2. 开始迁移 `workflow` 的入口到 Nest，但先不重写 workflow runtime。
3. 再迁移 `chat` 外壳到 Nest，内部 LangGraph / Pi L3 先保留。
4. 清理聚合入口导致的循环依赖，按语义子模块导入。
5. 把 CLI bridge 收缩为 `compat` 边界。
6. 后续再逐步原生化：
   - 米家认证和设备操作。
   - ADB UI 树、截图、OpenCV、视觉接口。
   - Bilibili 能力。
   - SSH terminal gateway。
   - Moonlight/Sunshine 串流管理。

## 下一轮开工提示词

见 [KICKOFF-3.md](./KICKOFF-3.md)。
