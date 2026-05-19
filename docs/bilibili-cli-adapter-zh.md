# Bilibili CLI Adapter 闭环说明

## 目标

这个模块不是要现在实现完整 B 站真实上传，而是给 HomeSense Studio 的生产力演示线提供一个可运行闭环：

`Workflow Studio -> agent.dispatch / cli.invoke -> adapter registry -> bilibili-cli -> 本地 dry-run 草稿`

它证明系统不只会控制电视，也能把外部 CLI 包装成工作流节点和 agent adapter。

## 当前实现

- CLI 本体：`packages/bilibili-cli`
- Executor manifest：`skills/bilibili-cli/EXECUTOR.json`
- Skill 说明：`skills/bilibili-cli/SKILL.md`
- Adapter 注册：`packages/backend/src/modules/agent-adapter/index.ts`
- 执行网关：`packages/backend/src/modules/executor-gateway/index.ts`
- Workflow 种子：`packages/backend/src/modules/workflow/seed.ts`

当前支持动作：

- `health`
- `prepare_upload`
- `set_metadata`
- `list_drafts`
- `submit_upload`

所有上传相关动作默认 dry-run。没有 `BILIBILI_COOKIE` 时，真实提交不会执行。

## 两条调用路径

### 1. CLI Executor 路径

Workflow 节点可以直接调用：

```json
{
  "executor_name": "cli.invoke",
  "params": {
    "cli_name": "bilibili-cli",
    "action": "prepare_upload",
    "params": {
      "title": "HomeSense Studio demo",
      "source_path": "./exports/homesense-demo.mp4",
      "tags": ["HomeSense", "AI Agent"],
      "dry_run": true
    }
  }
}
```

这是最直接的“任意 manifest 化 CLI 接入”证明。

### 2. Agent Adapter 路径

`agent.dispatch` 读取 adapter 上的 `adapter_binding`：

```json
{
  "kind": "cli",
  "cli_name": "bilibili-cli",
  "default_action": "prepare_upload"
}
```

所以 Studio 可以用统一 envelope 调用：

```json
{
  "target": "bilibili_cli",
  "task": "Prepare upload draft",
  "payload": {
    "title": "HomeSense Studio demo",
    "source_path": "./exports/homesense-demo.mp4",
    "dry_run": true
  },
  "execution_mode": "deferred"
}
```

这对应未来的 agent control-plane：不同 adapter 可以是 CLI、桌面自动化、代码 agent、远程机器人，但入口保持一致。

## 当前验证结论

- `bilibili-cli` 能被 `cliBridge.loadDiskExecutors('./skills')` 发现。
- `executorGateway.invoke('cli.invoke')` 能成功调用 `bilibili-cli.prepare_upload`。
- `Bilibili CLI Demo` workflow 能通过 HTTP `/api/workflows/:id/run` 成功执行。
- `agent.dispatch -> bilibili_cli` 能通过 adapter binding 实际执行 CLI。
- `agent.dispatch -> mi_adb` 也能通过 adapter binding 调用 `adb-cli.launch_app`。

## 后续扩展

真实 B 站项目接入时，只需要保持当前契约：

- 输入必须 schema 化。
- 输出必须是 `{ "status": "success", "data": ... }` 或 `{ "status": "error", "error": "...", "message": "..." }`。
- 真实上传、扫码登录、cookie 管理、分片上传等能力放在 `packages/bilibili-cli` 内部演进。
- Studio 和 WorkflowRuntime 不需要知道 B 站 API 细节。
