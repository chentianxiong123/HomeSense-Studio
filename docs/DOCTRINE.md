# 架构教条 (Architecture Doctrine)

> 本文件是硬性约束。任何 PR / commit 都必须对照。

## 1. 名词优先 (Noun-first)
**一个文件如果找不到自己的「名词」，不准建目录。**
没有名词归宿 = 没有职责 = 不该存在。

可用的 28 个名词：见 `docs/PLAN-noun-clustering.md` 的目标模块表。
不在表里的代码 = 需要归并或删除。

## 2. 模块隔离 (Module Isolation)
`modules/X/` 不得直接 import `modules/Y/`（Y != X）。
**唯一例外**：`shared/`（端口、类型、注册中心）和 `db/`（schema 与迁移）。

通过方式：调用 `shared/ports/` 中定义的端口接口，
实现由 `shared/registry/` 解析。

通过脚本检查：
```bash
npm run -w backend check:isolation           # 报告 (exit 0)
npm run -w backend check:isolation:strict    # 强制 (exit 1 当有违规)
```

迁移期的 baseline：152 跨模块 import（chat:30 / workflow:16 / device:10）。
目标：0。

## 3. 单一入口 (Single Public Entry)
每个模块的公开入口只有一个：`modules/X/index.ts` 导出有限符号。
**内部细节标 `_` 前缀**（`function _internal()`）。
跨模块只能 import 出现在 `index.ts` 里的导出。

## 4. 端口契约 (Port Contract)
跨模块调用 = 调用端口接口。端口定义在 `shared/ports/`，不允许在调用方内联定义。

每个端口必须有 1 个「契约测试」：验证实现的形状与端口一致。

## 5. 测试即文档 (Tests as Docs)
每个模块自带 1 个单测文件 `*.test.ts`。
- 通过 = 模块可独立工作（解耦成功）
- 跨模块只看端口契约测试

## 6. 迁移纪律 (Migration Discipline)
- 一个阶段改动一个 noun cluster
- 每合一个模块跑一次 `npm run -w backend test` 和 `npm run -w frontend test`
- 不通过立刻回退，不绕过
- 阶段合并以 git commit 为分界，写明合并的源模块

## 7. 失败信息 (Failure Surfacing)
- 不允许吞异常：`catch { }` 不准出现
- 不允许用 mock 数据替真：测试里也走真 DB（in-memory 实例）
- 任何"假装成功"的代码必须标注 `// FIXME: fake success` 并在 issue 里追踪

## 8. 文档同步 (Doc Sync)
- 改 `shared/ports/*.ts` → 改 `docs/PORTS.md`
- 改模块边界 → 改 `docs/PLAN-noun-clustering.md`
- 改 DB schema → 改 `packages/backend/src/db/schema/README.md`
