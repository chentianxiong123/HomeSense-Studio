# HomeSense v3 架构

> 状态: 已定案 (2026-08-29)
> 类型: 云 AI 管家 SaaS — 云大脑 + 边缘执行

---

## 一、定位

HomeSense v3 是一个 **云 AI 管家 SaaS**：AI 大脑（Agent/场景/规则/记忆）跑在云端，
用户通过一个轻客户端（手机 App / Web）使用；深度控制家庭环境时，用户自购一个
**边缘计算盒子**（BYOD 或订阅附送），负责局域网设备接入与低延迟执行。

### 核心价值主张

> 有身体（设备）的 AI 管家，住在用户家里，认得每个房间，
> 按用户习惯主动做事，深度控制 + 简单分发同时满足。

### 一句话分层

```
云端 = 大脑 (赚钱层: 订阅/计费/AI 决策)
边缘 = 神经末梢 (用户自购: 本地执行/隐私/低延迟)
```

---

## 二、总架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    云端 SaaS (Cloud)                          │
│                                                             │
│  ┌───────────┐ ┌──────────────┐ ┌────────────────────────┐  │
│  │ 账号/订阅   │ │  AI Agent 编排 │ │  场景/规则/记忆        │  │
│  │ 计费/多租户 │ │  顶层路由+角色 │ │  (云端大脑)           │  │
│  └───────────┘ └──────────────┘ └────────────────────────┘  │
│                                                             │
│  ┌───────────────────────────────────────────────────────┐  │
│  │          设备抽象层 (单一 Device API)                   │  │
│  └───────────────────────┬───────────────────────────────┘  │
└──────────────────────────┼──────────────────────────────────┘
                           │
           ┌───────────────┴───────────────┐
           │                               │
  云控数据源 (Cloud Data)          边缘数据源 (Edge Data)
  米家云 / 涂鸦云 / HA云           用户自购边缘盒子
  WiFi 设备直连                   局域网设备/adb/蓝牙/串流
                                  低延迟 + 断网降级 + 隐私
           │                               │
   ┌───────┴───────────────────────────────┴───────┐
   │           被控设备节点 (Device Nodes)          │
   │                                               │
   │   WiFi设备       局域网设备       传感器节点    │
   │   灯/插座/空调    电视(adb)/音箱   温湿度/人体  │
   │   净化器/窗帘     蓝牙设备/串流屏  门窗/摄像头   │
   └───────────────────────────────────────────────┘
```

**用户感知**: 一个 App、一张设备列表，不知道背后谁在执行。
**关键不变量**: 云控和边缘盒子实现**同一个 Device API**，上层完全无感。

---

## 三、分层详解

### 3.0 被控设备节点 (Device Nodes) — 最底层物理层

真实世界中被控制的物理设备，是拓扑的**最底层**。接入方式分两种：

| 设备类型 | 接入路径 | 示例 |
|---------|---------|------|
| **WiFi 云设备** | 厂商云 → 云端直连（云控数据源） | 米家灯/插座/空调/净化器/窗帘 |
| **局域网设备** | 边缘盒子本地协议 | adb 电视/音响/蓝牙设备/串流屏 |
| **传感器节点** | 上报到云端或边缘盒子 | 温湿度/人体感应/门窗/摄像头 |

**设备状态分三条**：
- 云设备: 厂商云驱动回报 → 云端同步
- 局域网设备: 边缘盒子轮询/事件 → 上报云端
- 传感器: 实时上报（高频走边缘，低频上云）

**绝不在设备节点存云端身份**：设备只认它的接入方（厂商云或边缘盒），
身份/权限/归属全部在云端 Device API 层解析。

### 3.1 云端 SaaS (apps/cloud) — 主角

| 模块 | 职责 |
|------|------|
| **账号/订阅** | 注册、登录、JWT、多租户隔离、订阅档位、计费 |
| **AI Agent 编排** | 顶层编排 Agent + 角色 Agent 路由（见 §4） |
| **场景引擎** | 起床/睡眠/离家等场景，串多个设备动作 |
| **规则引擎** | 传感器事件驱动，时间/温度/状态触发 |
| **记忆系统** | Markdown 文件 + SQLite 索引（借鉴 OpenClaw 分层） |
| **设备抽象层** | 单一 Device API，屏蔽云控/边缘差异 |
| **数据面** | 设备状态同步、事件流、用量统计 |

### 3.2 边缘盒子 (apps/hub) — 可选高级配件

**直接控制局域网设备的执行者**，是"被控设备节点"在用户家里的总管。

| 模块 | 职责 |
|------|------|
| **局域网接入** | adb(电视)、miio 局域网、蓝牙、串流 |
| **本地执行** | 开灯 100ms 级响应、断网降级运行 |
| **隐私边界** | 摄像头画面不出家门 |
| **离线规则** | 网络中断时本地跑最小规则集 |
| **云连接** | 主动 outbound 连云端 (WebSocket)，无需公网 IP |

**商业角色**: 不是收入主角，是留存工具 + Pro 订阅升级理由。

### 3.3 客户端 (apps/mobile + apps/web)

- **Web**: 管理控制台（家庭完整管理）
- **Mobile App**: 日常遥控器（先 WebApp/PWA，后期原生）
- 都只连云端，不直接碰设备

---

## 四、多 Agent 架构（自研，OpenClaw 没有）

**顶层编排 Agent + 角色 Agent 纵向分层**，OpenClaw 的多 agent 是横向
分通道/分房间，本设计为智能家居量身定制。

```
  用户/传感器/定时
        │
        ▼
┌──────────────────┐
│  顶层编排 Agent    │  ← 唯一面对用户的入口
│  理解意图/拆任务    │     判断"谁的话/什么意图/该谁干"
└────────┬─────────┘
         │ 自动路由 (按任务类型)
   ┌─────┼──────┬──────────┬──────────┐
   ▼     ▼      ▼          ▼          ▼
 影音   设备   安全        场景       闲聊
 Agent  Agent  Agent      Agent     Agent
 电视   灯/空调 摄像头    起床/离家   对话/知识
```

- **顶层 Agent**: 统一对话入口，路由决策，结果汇总回复
- **角色 Agent**: 只干自己领域的设备/技能，返回结果给顶层
- **路由依据**: v1 的 intent-router + rule_engine → LLM 分层决策升级版

---

## 五、设备模型（一切皆设备 — v2 哲学延续）

### 5.1 设备 = 一张 JSON（孪生）

```json
{
  "id": "dev_123",
  "name": "客厅电视",
  "room": "客厅",
  "owner": "user_456",
  "source": "edge",            // cloud | edge
  "props": {
    "adb_ip": "192.168.1.91:5555",
    "capabilities": [
      { "name": "turn_on", "executor": "adb.turn_on" }
    ]
  }
}
```

- **props 完全自由，无白名单、无 device_type enum**
- 能力 = `{ name, executor }`，executor 指向注册的执行器
- 房间/用户归属在设备 JSON 上

### 5.2 CAPABILITY_REGISTRY（能力字典，v2 mi-cli 继承）

```
capability key → { kind, name_cn, aliases, value_type, domains }
例: power → { kind: property, aliases: [on, switch-status], value_type: boolean }
```

- aliases 做归一化（"色温" vs "color-temperature"）
- domains 分域（switch/light/climate/cover/media_player/remote）
- 执行器: `mi.executor` / `adb.executor` / `ha.executor`（v1 44 模块收敛）

### 5.3 单一 Device API

```
GET    /api/devices              // 用户设备列表
GET    /api/devices/:id          // 设备详情(JSON孪生)
POST   /api/devices/:id/cap/:cap // 执行能力 (turn_on, set_brightness...)
GET    /api/devices/:id/state    // 实时状态
POST   /api/devices/:id/state    // 状态上报(边缘→云)
```

**云控与边缘盒子都实现这同一接口** — 上层无感，扩展新数据源 = 新实现。

---

## 六、UI 架构

**原则**: pi-web 的发动机 + PicoClaw 的车身 + shadcn 的零件

### 6.1 技术栈

```
Next.js (全栈) + React 19 + TypeScript
Tailwind CSS v4 + shadcn/ui + @tabler/icons-react
@tanstack/react-query + jotai
React Flow (Studio 画布)
```

### 6.2 布局（PicoClaw 三件套）

```
AppLayout (骨架)
├── AppHeader  — Agent 状态/启停 + 主题 + 账号
├── AppSidebar — 分组折叠导航 (房间/设备/场景/规则/对话/设置)
└── 主内容区
```

### 6.3 双模式

```
控制台模式 (日常): 房间/设备/场景/规则/聊天 — shadcn 卡片风格
Studio 模式 (生产力): React Flow 画布工作流编排 — v1 Studio 平移
```

### 6.4 为什么这样选

| 参考 | 拿来 | 抛弃 |
|------|------|------|
| PicoClaw UI | shadcn 组件/布局三件套/简约交互 | Vite SPA（无后端） |
| pi-web | Next.js 基础设施(已验证) | 自研组件体系 |
| v1 Studio | 工作流编排逻辑 | Vue 实现（换 React Flow） |
| OpenClaw UI | 多 Agent 交互思路 | 76 万行太重 + 自研组件 |

---

## 七、技术栈总览

| 层 | 技术 | 说明 |
|----|------|------|
| 云端 | Next.js 全栈 or 独立服务 | API Routes 做后端 |
| 客户端 | Next.js Web + PWA | 后续原生 App |
| 边缘盒 | Node.js 轻量进程 | 复用 v3 全家桶逻辑 |
| 存储 | SQLite + Markdown 文件 | 记忆文件化 |
| 通信 | WebSocket (边缘↔云) + REST (客户端↔云) | |
| 类型 | TypeBox | 协议校验 |
| Agent | LLM + 规则引擎混合 | v1 渐进式披露 |

---

## 八、v1 44 模块迁移映射（原则）

```
上云 (云端编排):  agent-adapter, intent-router, rule-engine, experience,
                  plan-library, memory-kernel, workflow, cron,
                  llm-provider, rerank-service, self-enhancement ...
进边缘 (执行层):  device, entity-registry, executor-gateway,
                  runtime-capability-map, screen-understand ...
进 UI:            approval 去除(无审批), settings 保留 ...
```

**原则**: 决策逻辑上云，执行逻辑进边缘，UI 用 shadcn 重写。

---

## 九、商业模型

| 档位 | 内容 | 角色 |
|------|------|------|
| 基础版 | WiFi 云控设备 + 基础 AI | 拉量/分发 |
| Pro 版 | + 边缘盒子(局域网设备/本地AI/高级自动化) | 留存/赚钱 |

**订阅制**: AI 能力在云端，不续费即停，天然克制。
**盒子**: Pro 订阅附送/低价 — 从"收入"降级为"留存工具"。

---

## 十、多租户原则（核心定案）

### 10.1 共享进程 + 数据隔离（不 per-user 容器）

**多用户 ≠ 每用户开容器。** 云端跑**一套共享进程**，用户隔离靠数据层：

```
云端就一套进程
│  Postgres (docker 跑一套, 不是每人一套)
│  LLM 网关 (共享)
│  Agent 服务 (共享进程)
│
└── 每用户 = 数据库一行 tenant_id
     用户1 → tenant_id=1 (对话/记忆/设备绑定)
     用户2 → tenant_id=2
     隔离 = WHERE tenant_id = ?  (一行代码, 不是一台容器)
```

- 这是 Notion / Supabase 的模型：几千万用户共享同一套 Postgres + 进程
- **禁止 per-user 容器**：100 用户 = 300 容器必炸，绝不做
- Docker 只跑内部那**一套**基础设施（Postgres/Redis/LLM 网关），全用户共享

### 10.2 基础设施不暴露给用户（内部实现细节）

- **产品 = 多租户 Agent 服务**（顶层编排 + 角色路由 + 记忆）
- n8n / HA / Postgres / Redis 是**内部工具**，用户看不见、摸不着
- 用户接触到的只有：App/Web → Agent 服务 → LLM → 结果
- 基础设施是内部实现，**不是产品组成部分**

### 10.3 自用用 n8n，商业再切换

- 家庭端/边缘盒/开发期：**直接用 n8n 官方版**（自用合法，不裁剪源码）
- n8n 技能可迁移（节点/webhook/条件分支思想 → Windmill/Temporal 通用）
- **商业 SaaS 红线**：不把 n8n 免费版打包卖给第三方（SUPL 禁止），届时买企业版或换 Windmill
- 核心编排逻辑自己写（顶层 Agent 路由是产品壁垒）

### 10.4 巨人肩膀原则

| 站巨人肩膀 ✅ | 背巨人尸体 ❌ |
|---------------|--------------|
| n8n 官方包直接装 | clone 源码裁一半自己维护 |
| HA 直接用全部集成 | 自己造设备接入框架 |
| miio/adbkit npm import | 自己写 Python CLI 壳 |
| shadcn/React Flow import | 自己搓组件 |

**用别人 = 90%（库/官方包），自己写 = 10%（云端编排层 + 账号 + 设备 JSON 模型）。**

---

## 十一、合规红线（借用组件许可证）

| 组件 | 许可证 | 商用结论 |
|------|--------|---------|
| miio | MIT | ✅ 安全 |
| adbkit | Apache-2.0 | ✅ 安全 |
| Home Assistant | Apache-2.0 | ✅ 安全（装进边缘盒子，Apache 随便商用） |
| **n8n** | **Sustainable Use** | ⚠️ 自用合法；**禁止打包进商业 SaaS 卖给第三方**，届时买企业版/换 Windmill |
| 其他 GPL 库 | GPL | ⚠️ 商用需开源编排层，逐项排查 |

**原则**: 核心编排自己写（产品壁垒），外部调库/官方包（巨人肩膀）。

---

## 十二、里程碑

```
Phase 0: 本文档定案 ✅
Phase 1: monorepo 骨架 + 云端核心 (账号+设备抽象层+Agent编排+tenant_id 多租户)
Phase 2: Web 控制台 UI (shadcn 三件套 + 侧边栏 HomeSense 语义)
Phase 3: Studio 模式 (React Flow 画布)
Phase 4: 边缘盒子 (Device API 第二实现 + outbound 连接)
Phase 5: 商业化 (订阅/计费/多租户)
```

---

## 十三、关键决策记录 (ADR 摘要)

1. **[D1]** 拒绝 NestJS — Next.js 全栈，前后端一体
2. **[D2]** UI = PicoClaw 结构 (shadcn) + pi-web 发动机，不用 OpenClaw UI
3. **[D3]** 多 Agent = 顶层编排 + 角色路由（自研），非 OpenClaw 横向分通道
4. **[D4]** 设备 = JSON 孪生，props 自由无白名单，单一 Device API
5. **[D5]** 无审批层 — 家居场景信任 agent，直接执行（保留回滚）
6. **[D6]** 云大脑 + 边缘执行；盒子是可选高级配件非必需门槛
7. **[D7]** 记忆 = Markdown 文件 + SQLite 索引（借鉴 OpenClaw 分层思想）
8. **[D8]** 多租户 = 共享进程 + tenant_id 数据隔离（禁止 per-user 容器）
9. **[D9]** 基础设施（n8n/HA/Postgres）不暴露给用户 — 内部实现细节，产品 = Agent 服务
10. **[D10]** n8n 自用直接用官方版（技能可迁移）；商业 SaaS 禁止打包 n8n 免费版，届时切换
11. **[D11]** 巨人肩膀原则 — 用库/官方包 90%，只自己写云端编排层 + 账号 + 设备模型
12. **[D12]** 实验性项目定位 — 先做 Agent 服务，不上线不影响合法自用
13. **[D13]** 商业 = 订阅制；基础版云控拉量，Pro 版盒子留存
14. **[D14]** 渐进式披露保留 — 规则引擎优先，LLM 兜底