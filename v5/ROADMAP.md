# HomeSense v5 — 演进记录 (Roadmap)

> 从 `docs/v3/CLOUD-EDGE-BLUEPRINT.md` 演进到 v5 的历程、动机与迁移计划。

---

## Timeline

| 阶段 | 状态 | 要点 |
|---|---|---|
| v3 | ✅ 已实现 | 多租户隔离、per-tenant SQLite/timeline/sessions/memories、admin 模型管理、思考/正文分离渲染、模型热切换 |
| v4 | ⏭ 跳过 | —— |
| **v5** | 🔵 设计讨论中 | 明确"一个家庭一个大脑"，会话模型从"一人一条"改为"全家共享 + 渠道路由"；沉淀于 `v5/ARCHITECTURE.md` |

---

## 为什么要有 v5

### v3 已解决
- 多账号/多租户**数据隔离**：per-tenant 库、目录、时间线。
- 模型管理 & 热切换（`set_model` 运行时生效）。
- 前端展示：思考与正文分离。

### v3 未解决 / 与家用智能体定位冲突
1. **会话模型**：`tenants.active_session_id` 绑"一人一条 session"，切碎家庭共享记忆；按渠道路由又会无限开会话。
2. **没有"家庭大脑"概念**：Web 聊天体验尚可，但飞书/音箱等渠道接入后没有统一汇聚点。

### v5 的转向
> 定位从"多租户 SaaS 平台"收敛为 **"一个家庭一个大脑的智能体"**。

- **会话**：全家共享一条上下文，渠道只是耳朵和嘴。
- **记忆**：无界 timeline + 压缩滚动窗口 + 每轮记忆快照。
- **版本**：递归地，v3 的多租户隔离是 v5 的地基，不是推翻。

---

## 迁移计划（草案，未动工）

```
v5 目录            ← 架构文档、设计来自这里
  └─ 实现落地       ← 待拍板后另立（可能仍在 apps/web 演进，或新代码库）
```

1. **schema**：新增 `sessions`（渠道+conversation 懒创建）、`members`（家庭多账号）、`channel_routes`（渠道→大脑汇聚）。
2. **迁移**：`active_session_id` 数据迁入新 sessions 表（web 渠道 = 家庭默认对话），保持现有行为不中断。
3. **渠道首验**：接一个真实渠道（飞书 bot）验证"IO 口"模型。
4. **骨骼**：为将来的 worker 池/粘性路由预留接口（不实现）。

---

## 参考

- 架构决策：`v5/ARCHITECTURE.md`
- v3 实现：`apps/web`（Next.js 16 + pi 引擎 + 多租户）
- 渠道层借鉴来源（未采纳基座）：`/mnt/shared/picoclaw-src/pkg/channels/`