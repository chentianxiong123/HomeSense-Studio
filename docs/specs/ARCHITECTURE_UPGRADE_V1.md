# HomeSense Architecture Upgrade v1

## 1. 为什么现在要升级架构

HomeSense 当前已经形成了一个可运行的本地 Agent 主链路：

- `rule_engine`
- `local_intent`
- `success_paths`
- `llm_agent`
- `tool_executor`
- `write_back`

这条链路证明了项目的方向是对的，但新的问题也已经出现：

1. 当前工具仍偏“项目内部自洽”，对外部先进体系借鉴不够
2. graph 虽然已经尽量保持薄，但工具接入层还没有形成真正稳定的统一中间层
3. `skills` 已经存在，但还没有成为所有工具的第一原则
4. `write_back` 已经存在，但距离 Harness 风格“自我增强”还差一个经验整理层
5. 可视化编排还没有明确落点，容易和 graph / planner / tools 混在一起

因此，HomeSense 下一阶段不应只是继续堆功能，而应把当前成果重新收敛成一个更先进、更可扩展的分层：

- **现实接入不变**
- **CLI + skills 成为统一中间层**
- **graph 继续做在线动态流转**
- **经验层从简单写回升级为自我增强闭环**
- **未来接入 visual orchestration，但不让它取代 agent 内核**

---

## 2. 主题思想保持不变

无论如何升级，HomeSense 的主题不能变：

> HomeSense 不是纯聊天应用，不是纯工作流平台，也不是纯研究框架。
> HomeSense 的核心目标，是做一个**真正接入现实世界的 agent**。

这意味着：

- 智能必须最终落到现实工具执行
- 编排必须服务于现实任务，而不是只服务于画布
- 工具层必须稳定、可控、可追踪
- 模型只是能力来源之一，不是全部
- 一切高层抽象都必须最终能映射到现实动作

---

## 3. 外部项目给 HomeSense 的新启发

### 3.1 Harness 风格：自我增强

值得借鉴：
- 从执行 trace 中学习
- 不是只保存结果，而是抽取策略
- 成功和失败都能变成长期经验

HomeSense 启发：
- `write_back` 之后应该增加“经验整理层”
- `success_paths` 不应只是动作缓存，还要逐步升级成 skillbook / strategy memory

### 3.2 OpenClaw 风格：统一平台管理

值得借鉴：
- 多工具、多能力、多 agent 的统一接入与管理
- 平台层关注 registry / runtime / observability，而不是具体单次 prompt

HomeSense 启发：
- 需要一个真正稳定的中间接入层
- 工具不能只以当前内部 TS 对象形式存在，而要能被统一注册、发现、调用、管理

### 3.3 CLI + skills：渐进式披露

值得借鉴：
- 工具真实能力不应一次性全暴露给模型
- 通过 skills 控制“什么时候看见什么能力”
- CLI 可以成为上下层屏蔽的中间层

HomeSense 启发：
- 所有工具最终都应遵循 `CLI + skills` 原则
- `skills` 不是附属品，而应成为工具暴露的默认方式
- CLI 不是和当前 graph 冲突，而是 graph 下方的统一调用层

### 3.4 Dify / Flowise / Coze 风格：可视化编排

值得借鉴：
- 节点化、流程化、用户可见的工作流表达
- prompt、tool、knowledge、workflow 的统一产品面

HomeSense 启发：
- 可视化编排可以成为未来上层
- 但它必须建立在稳定的 CLI + skills + reality tools 之上
- 不能反过来决定底层 Agent 内核怎么长

---

## 4. 升级后的总分层

```text
User / API / Future UI / Future Visual Canvas
                    ↓
        Planning & Orchestration Layer
        ├─ Chat orchestration (graph)
        ├─ Visual workflows
        ├─ AI self-orchestration
        └─ Human approval / governance
                    ↓
             CLI + Skills Layer
        ├─ Unified command surface
        ├─ Progressive skill disclosure
        ├─ Capability contracts/schema
        └─ Tool registry / capability registry
                    ↓
          Runtime & Execution Layer
        ├─ rule_engine
        ├─ local_intent
        ├─ retrieval
        ├─ success_paths
        ├─ llm_agent
        ├─ tool_executor
        └─ write_back / reflection
                    ↓
            Reality Access Layer
        ├─ adb
        ├─ hami / Home Assistant / Mi Home
        ├─ memory / sqlite / local files
        ├─ web / future platform connectors
        └─ future device adapters
```

---

## 5. 新的核心判断

### 5.1 graph 仍然保留，但不是最终中心

graph 继续负责：
- 在线请求流转
- Fast / Deep 切换
- 阈值判断
- write_back 入口

但 graph 不再承担：
- 全部工具的最终抽象
- 全部 workflow 的唯一表达方式
- 未来可视化编排的唯一载体

结论：
- **graph 是在线调度层，不是整个系统的统一中间层**

### 5.2 CLI 是新的统一中间层

CLI 的职责不是做 shell 花活，而是做**能力统一抽象**。

它应该屏蔽：
- 上层的 planner / graph / visual workflow
- 下层的 adb / hami / memory / web_search / future tools

统一后的调用面应该具备：
- 标准命令命名
- 统一输入输出 contract
- 统一权限 / 风险分级
- 可被 skills 描述
- 可被 visual layer 编排
- 可被 AI 自动组合

示意：

```text
graph wants to click TV search button
        ↓
cli.run("tv.search.click", args)
        ↓
skill resolves how this capability should be exposed
        ↓
adb / perception / targeting / fallback execution
```

### 5.3 skills 成为工具第一原则

未来 HomeSense 里：
- 工具实现是真实能力底座
- CLI 是统一命令面
- skills 决定模型/编排层看到什么能力、看到多少、以什么形式看到

所以 skills 不再只是帮助文档，而应该逐步承担：
- 能力摘要
- 使用前提
- 风险说明
- 输入输出约束
- 示例模式
- 何时披露 / 何时隐藏

结论：
- **所有工具都应该遵循 CLI + skills 原则**

### 5.4 write_back 要升级成反思闭环

当前 write_back 主要产物：
- success_path
- execution_summary
- rule_candidate
- reflection text

升级后应该变成两段：

```text
execution result
  ↓
write_back (raw event persistence)
  ↓
reflection / skill distillation
  ↓
rule candidate / success path / failure avoidance / strategy memory
```

这样可以避免：
- 一次 probe 输入污染经验层
- 一次 deep 猜对立即固化
- 经验层只有动作，没有适用条件

### 5.5 visual orchestration 是上层，不是底层

未来 HomeSense 可以有：
- 类 Dify / Flowise / Coze 的画布
- 用户自己拼工作流
- AI 自己生成工作流草图
- 人机共同修改流程

但这些都必须建立在：
- CLI 稳定
- skills 可读
- tool contract 稳定
- runtime 可追踪

结论：
- **visual orchestration 是上层编排面，不是底层内核**

---

## 6. HomeSense v1 的关键对象

### 6.1 Capability

系统里最小可编排能力单元。

示例：
- `tv.open`
- `tv.go_home`
- `tv.find_text`
- `speaker.play_music`
- `homeassistant.run_voice_command`

### 6.2 CLI Command

Capability 的统一命令表达。

示例：
- `device.tv.open`
- `device.tv.navigate.home`
- `device.tv.ui.find_text`
- `device.audio.play`

### 6.3 Skill

Capability 的模型可见包装。

包含：
- 能力说明
- 风险级别
- 输入要求
- 示例
- 渐进披露策略
- 适用上下文

### 6.4 Execution Trace

所有运行结果必须留下结构化 trace，供：
- 调试
- 观测
- 经验整理
- 自我增强

### 6.5 Strategy Memory

比 success_path 更高一层的经验对象。

它不只记录：
- 做了什么动作

还记录：
- 在什么条件下这样做
- 哪些信号表明这条路靠谱
- 哪些情况不该复用

---

## 7. 建议的近期落地路线

### Phase 1：统一 CLI + skills 抽象

目标：
- 不大改 runtime 逻辑
- 先把工具能力抽成统一 capability / command / skill 视图

要做：
- 给现有 adb/hami/memory/success_paths 定义 capability 命名规范
- 给 tool action 补统一 command schema
- 让 `skills` 从文档升级成半结构化 contract
- graph 内部仍可先调用旧实现，但抽象上对齐 CLI

### Phase 2：反思与经验整理层

目标：
- 把当前粗写回升级成轻量自我增强闭环

要做：
- 区分 raw event persistence 和 distilled memory
- 给 success_path 增加适用条件/风险条件
- 增加 strategy refinement / merge / retire 逻辑
- 对 deep 结果默认更保守，不轻易自动提升

### Phase 3：平台接入层升级

目标：
- 形成 OpenClaw 风格的统一接入平台层

要做：
- capability registry
- tool registry
- execution policy / risk grading
- better observability / checkpoint / resume

### Phase 4：可视化编排层

目标：
- 引入类似 Dify / Flowise 的 workflow 可视层

要做：
- 设计 HomeSense 的节点模型
- 让节点最终映射到 CLI + skills
- 支持 human-authored workflow
- 支持 AI-assisted workflow drafting

### Phase 5：AI 自编排

目标：
- 让 AI 在同一套中间表示上为自己生成/调整流程

要做：
- workflow DSL / graph IR
- plan validator
- self-orchestration + approval
- replay / comparison / policy guardrails

---

## 8. 当前代码对这个方向的兼容性

好消息是，HomeSense 当前并不需要推翻重来。

已经兼容新方向的部分：
- graph 已经在尽量保持薄
- `StageResult` / `IntentSchema` 已经是中间语言雏形
- `skills` 已经存在，只是还没成为第一原则
- `write_back` 已经存在，只是还没升级成反思闭环
- 工具已经是分目录/分模块结构，适合继续抽象为 capability / CLI

需要升级的部分：
- tool action 还不够统一
- capability registry 还不存在
- skill disclosure 还没有真正控制工具暴露
- visual workflow 完全还没落地
- 经验层还偏事件记录，不够策略化

---

## 9. 对当前开发的直接指导

从现在开始，HomeSense 后续架构决策应遵循：

1. 不再把 tool implementation 直接视为系统最终抽象
2. 所有工具都应逐步对齐到 `CLI + skills` 原则
3. graph 继续薄化，只做在线流转
4. write_back 默认保守，优先保证经验层干净
5. success_path 是过渡形态，长期目标是 strategy memory / skillbook
6. visual orchestration 是未来上层，不要反过来污染底层 runtime
7. 一切设计最终都要落回“现实接入 agent”主题，而不是变成纯 workflow 平台

---

## 10. 一句话总结

> HomeSense 下一阶段，不是继续闭门堆功能，而是把现有现实接入 Agent，升级成：
> **以现实工具为底座、以 CLI + skills 为统一中间层、以 graph 为在线调度、以经验反思为自我增强闭环、并为未来 visual / self orchestration 预留上层空间的本地 Agent 平台。**
