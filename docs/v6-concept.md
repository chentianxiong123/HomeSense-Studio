# HomeSense Studio v6 · 理念文档

> 定稿日期：2026-09-03 · 状态：开发中（M1 PoC 验证阶段）

## 0. 一句话定义

**云边协同的 AIoT SaaS**：云端跑 AI Agent（大脑），本地只留轻量执行器（四肢）；大脑生成原子指令，四肢操作家庭设备；一人一实例、一人一库、隐私永不出设备。

## 1. 为什么是 v6 —— 五次失败的真相

v1-v5 反复用 Node/NestJS/NextJS 去扛「模型调度 + 多租户 + 边缘执行」这类**基础设施级任务**，全部跪在架构而不在实力。v6 不再自造轮子，姿态改为：**给别人的强力组件当胶水**。

| 五次的坑 | v6 的对策 |
|---|---|
| Web 框架扛基础设施 | Go：单进程高并发、并发协程级 |
| 自写模型网关/计费 | 直接用 **new-api**（AGPLv3）当网关 + 账本 |
| 自写 Agent 编排 | 直接用 **picoclaw**（MIT）当 Agent 内核，官方原生多实例 |
| 复杂 DB/连接池 | 一人一 SQLite/JSONL 文件，省掉 Redis/MySQL 连接池 |
| 追 NextJS 前沿 | 前端复用 picoclaw 自带 Web/session，慢开发留给收益高的部分 |

## 2. 核心设计哲学

- **云端智能，本地执行**：推理只在云端，设备端不做任何 AI 推理
- **一人一实例，一人一库**：每个用户独立 Agent 实例（进程内对象级）+ 独立 SQLite/JSONL，**数据物理隔离**
- **越用越快**：三级沉淀——云端探索新任务 → 沉淀脚本/工作流 → 本地缓存执行，高频任务本地闭环
- **超卖是生意不是 BUG**：裸进程 + 进程内多实例 + LRU 换出，用 Go 的并发换内存，一台 64GB 消化几千注册级用户

## 3. 分层架构（已敲定）

```
用户接入层    复用 picoclaw 自带 Web / session API（后续独立 App 再说）
云端控制面    new-api（网关 + 计费，原样部署不 fork） + PostgreSQL 账本
云端 Agent层  picoclaw fork：AgentRegistry 进程内多实例，一人一 AgentInstance
本地执行层    自研 Go MCP 执行器：ADB / 米家 / DLNA / 资源嗅探，只执行原子指令
本地存储      每用户独立 SQLite / JSONL（会话、沉淀工作流、设备状态映射）
```

## 3.1 new-api 可见性隔离（管理员专用·用户不可见）

**new-api 只存在于服务端内网，是给 v6 自己/管理员看的，用户永远接触不到。**

```
用户 ──> HomeSense 前端（picoclaw Web UI，白标）
             │
             v
        v6 后端（控制器/调度）          ← 多租户逻辑在这层，对用户是唯一入口
             │
             v
        new-api（内部网关·管理员专用）   ← 隔离在服务端网络，用户碰不到
             │
             v
        模型（vLLM/Ollama/云 API）
```

- 用户只面对 HomeSense 自己的界面/API，不知道 new-api 存在
- new-api 仅监听内网（`127.0.0.1`/私有网段），外部无法直连；v6 后端是唯一能打到它的代理
- 用户计费/配额由 **v6 后端按自有账号体系**记账；new-api 只做「v6 ↔ 模型」的统一出口 + 管理员成本报表
- 管理视角分离：用户看 HomeSense，管理员后台看 new-api

## 4. 已被验证的关键事实（基于官方源码）

- `AgentRegistry`（`pkg/agent/registry.go`）= `map[string]*AgentInstance`，**官方原生单进程多实例**，路由按 dispatch rule 分派，会话内串行、跨会话并发
- 每实例独立 `Workspace` + 独立 session store（JSONL 每 agent 一个目录）
- 两个必须补的点：① 注册表**没有运行时热增/热删** → 加 `AddUserAgent/RemoveUserAgent`；② seahorse SQLite **全局单库**（hardcode default agent workspace）→ 若用 seahorse 需改为 per-agent 定位；不用则直接用 per-agent JSONL
- new-api 有 **ChannelAffinity**（同用户粘同渠道）+ quota/流水账本 + PG 原生支持

## 5. 计费模型（已决定）

- **new-api 是唯一账本**：余额、流水、扣费全在它（连 PG），但**只对管理员可见**
- **用户不可见**：计费只经 v6 后端在自家账号体系内暴露（查余额/充值入口），用户无任何 new-api 接口/地址
- SaaS 账号体系只做「映射 + 登录」，把用户映射成 new-api 用户/令牌
- **不 fork new-api**：原样部署，经 admin API 对接，规避 AGPL 源码披露义务
- Picoclaw 只读余额（够才放行），**不写 PG 计费表**

## 6. 数据流（已决定）

```
用户指令 → HomeSense 前端（唯一的对外入口）
  → v6 后端（控制器/调度，查自家账号体系余额/配额）
  → picoclaw 实例（查余额够才继续）
  → SQLite 查缓存（命中→直接下发，本地闭环）
  → 未命中 → v6 后端代发 → new-api（内网内部网关，统一扣费）→ 大模型返回
  → picoclaw 解析意图 → 生成原子指令
  → WebSocket 长连接 → 本地 MCP 执行器 → 执行 → 回结果
  → 沉淀到 SQLite（加速下次）
```

补注：→ new-api → 这一段全程在服务端内网进行，用户只与「前端/v6 后端」交互，见 §3.1。

补充待办：**离线消息队列 + 幂等投递**（手机间歇在线）、长连接**双向认证**。

## 7. 与上游的关系（新决策）

- **直接复制，不跟随上游**：官方 picoclaw 源码整份复制进 v6 作改动基线，不再做 replace/vendor 跟踪上游更新
- 需要 patch 的两处直接在副本上改（registry 热增删、seahorse per-agent），行为以 v6 内这份为准
- 官方源 `/mnt/shared/picoclaw-src` 保留只读，老魔改仓库零接触

## 8. 许可证

| 组件 | 许可 | 使用方式 |
|---|---|---|
| new-api | AGPLv3 | 原样部署当网关账本，不 fork；保留 LICENSE/版权 |
| picoclaw | MIT | 复制改，可闭源发布 |
| 本地 MCP 执行器 | 自研 | 完全自主 |
| 控制面/supervisor | 自研 | 完全自主 |

## 9. 验证里程碑

1. **M1 PoC 并发压测**：`usersim` 虚拟用户池压进程内多实例——已完成（16~128 并发用户，零隔离违规，见 `cmd/usersim`）
2. **M2 真实场景压测**：复用 `/mnt/shared/.picoclaw/workspace` 真实数据——已完成
   - 注入：28 条真实用户话术 + 8 个真实 skills + SOUL/AGENT 人格，每用户 workspace 独立复制加载
   - 场景感知 mock：工具意图（查内存/看进程/推代码/查天气）触发真实 `exec` 工具执行，走通 LLM→工具→结果回填→二次 LLM 完整链路；含工具失败回填路径
   - 实测：64 用户 384 turns，238 个真实工具轮，0 隔离违规/0 超时，峰值 Heap +23MB（约 58KB/用户）；数据见 `cmd/usersim`
3. **M3 主链路**：前端 → picoclaw 实例 → new-api → 模型 → 本地执行器，走通端到端
4. **M4 控制面**：用户↔实例分配、LRU、迁移
5. **M5 生产**：离线队列、幂等、鉴权加固、账号/计费对接

## 10. 待定点

- [ ] fork 副本路径定稿（当前 `third_party/picoclaw`）
- [ ] 默认会话存储：直接用 per-agent JSONL，还是补 seahorse per-agent 改造
- [ ] 本地 MCP 执行器协议细节（ws 二进制帧、幂等键）