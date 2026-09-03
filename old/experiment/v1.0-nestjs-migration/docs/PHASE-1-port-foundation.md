# 阶段 1：端口基线 (Port Foundation)

> 分支：`refactor/noun-clustering`
> 提交：（本次 commit）

## 目标
为「按语义名词聚类」提供基础设施，让后续 19 个模块合并有章可循。

## 新增

### 6 个核心端口（`packages/backend/src/shared/ports/`）
| 端口 | 文件 | 角色 |
|---|---|---|
| `LlmPort` | `llm.ts` | 任何 LLM（chat / embed / rerank）的边界 |
| `MemoryPort` | `memory.ts` | 记忆层（FTS / graph / embedding / 经验路径）的边界 |
| `RulePort` | `rule.ts` | L1 反射层（同步、低延迟） |
| `DevicePort` | `device.ts` | 任何设备调用（adb / mqtt / http / 沙箱） |
| `SkillPort` | `skill.ts` | Skill 加载、MCP 注册、渐进披露 |
| `IntentPort` | `intent.ts` | 意图分类（轻量、LLM 之外） |

每个端口只声明接口，**当前没有任何实现调用**——目的是先把形状定下来。

### 1 个隔离检查脚本
`scripts/check-module-isolation.mjs`：
- 报告模式 (`check:isolation`)：默认 exit 0，列出所有违规
- 强制模式 (`check:isolation:strict`)：有违规即 exit 1

用法：
```bash
npm run -w backend check:isolation           # 报告
npm run -w backend check:isolation:strict    # 强制
```

`packages/backend/package.json` 加了对应 npm script。

## 现状 (Baseline)
跑 `check:isolation --by-source` 看到：
```
== cross-module imports by source module ==
  chat                         30 violations
  workflow                     16 violations
  device                       10 violations
  agent-runtime                9 violations
  candidate-plan               7 violations
  executor-gateway             7 violations
  intent-router                7 violations
  ...
```

**152 个跨模块 import，目标是 0。**

## 配套文档
- `docs/DOCTRINE.md` — 8 条架构教条（名词优先、模块隔离、单一入口、端口契约…）
- `docs/BASELINE.md` — 测试基线（5 失败 / 280 通过 / 285 总数）

## 下一步
阶段 2：合并 19 个小模块到 28 个名词目录。
起点建议：`registry`（3→1）+ `rule`（2→1），风险最低。
