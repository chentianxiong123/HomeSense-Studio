# HomeSense Studio v2

> 家庭智能体平台 — 统一代码库

## 分支结构

```
main              ← 🟢 当前主线 (v2 monorepo)
archive/v1-master           ← 📚 v1 master 归档 (34 commits)
archive/nestjs-migration    ← 📚 NestJS 迁移 + 设备发现架构 (26 extra)
archive/noun-clustering     ← 📚 模块合并重构 (17 extra)
archive/gateway-streaming   ← 📚 schema 拆表 + mobile PWA (9 extra)
archive/pi-experiment       ← 📚 L3 runtime 实验 (1 extra)
```

**设计原则**: `main` 单一演进，`archive/*` 只读快照，不合并进主线。

## 项目结构

```
apps/
├── server/   @hs/server   — NestJS v11 后端 (Fastify)
└── web/      @hs/web      — Vue 3 前端 (Vite)
packages/     — 共享包 (domain, api-client, ui, 原生包)
cli/          — CLI 工具 (adb, mi, hami)
homesense-core/ — 旧 HomeSense core 归档
homecast/     — HomeCast 归档
studio-v1/    — v1 Studio 完整代码（subtree 保留）
docs/         — 设计文档
```

## 快速启动

```bash
pnpm install
pnpm --filter @hs/server start:dev    # 后端 :3100
pnpm --filter @hs/web dev             # 前端 :5173
```

## 里程碑

| Tag | 说明 |
|---|---|
| `v1.0-aggregated` | 所有散落支线归档完成 |
