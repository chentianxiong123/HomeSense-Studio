# HomeSense Capability & Command Schema v0

## 1. 目标

这份文档定义 HomeSense 下一阶段的统一中间层雏形：

- `capability naming`
- `command schema`
- `tool -> capability` 映射方式

目标不是立刻替换现有 `ToolAction`，而是给现有系统增加一个更稳定的抽象层，让未来可以同时承接：

- graph 在线调度
- skills 渐进式披露
- visual orchestration
- AI self-orchestration
- platform/runtime registry

---

## 2. 设计原则

### 2.1 capability 是稳定抽象

`tool` 和 `action` 属于当前实现层。

`capability` 属于系统级抽象层，应该：
- 比底层实现稳定
- 比自然语言更明确
- 比当前单次 ToolAction 更适合复用

例如：
- `adb.back` 是实现动作
- `device.tv.navigate.back` 是 capability

### 2.2 CLI 是中间层，不是 shell 技巧

这里说的 CLI，不是要求用户手写命令，而是要求系统内部有一套统一命令面。

它的作用：
- 对上屏蔽 graph / planner / workflow / UI 的差异
- 对下屏蔽 adb / hami / memory / retrieval 等工具实现差异

### 2.3 skills 围绕 capability 披露，而不是围绕底层脚本披露

未来 skills 应描述：
- 当前能调用哪些 capability
- capability 需要什么输入
- 什么时候适合调用
- 风险和前提是什么

而不是只描述“某个工具文件里有什么 action”。

### 2.4 v0 不追求完美，只追求能落地

v0 的要求：
- 现有工具能映射进去
- graph 以后能逐步使用
- future registry / visual layer 能基于它扩展

---

## 3. Capability Naming 规则 v0

采用四段式优先命名：

```text
<domain>.<resource>.<operation>[.<variant>]
```

规则：

1. **domain**
   - 表示能力域
   - 例如：`device` / `home` / `memory` / `agent` / `system`

2. **resource**
   - 表示被操作对象
   - 例如：`tv` / `speaker` / `ui` / `messages` / `rule` / `success_path`

3. **operation**
   - 表示主要动作
   - 例如：`open` / `navigate` / `inspect` / `search` / `record`

4. **variant**
   - 表示更细粒度分支（可选）
   - 例如：`back` / `home` / `text` / `screenshot`

### 3.1 命名要求

- 尽量表达“用户/agent 想完成什么”，而不是“底层脚本怎么做”
- 同一个 capability 允许由不同工具实现
- 命名偏中粒度，不直接暴露底层全部细节

### 3.2 示例

- `device.tv.power.open`
- `device.tv.navigate.back`
- `device.tv.navigate.home`
- `device.tv.ui.inspect.tree`
- `device.tv.ui.inspect.screenshot`
- `device.tv.ui.find_text`
- `device.tv.ui.click_text`
- `device.audio.play.music`
- `home.voice.execute`
- `memory.chat.read`
- `memory.chat.append`
- `agent.fast.rule.match`
- `agent.fast.intent.match`
- `agent.fast.success_path.search`
- `agent.deep.plan`
- `agent.deep.reflect`

---

## 4. Command Schema v0

```ts
export interface CapabilityCommandV0 {
  schemaVersion: 'command_v0'

  commandId: string
  capability: string

  target?: {
    domain?: 'tv' | 'speaker' | 'home' | 'phone' | 'agent' | 'memory' | 'unknown'
    device?: string
    room?: string
    app?: string
    element?: string
  }

  operation?: {
    name?: string
    value?: string | number | boolean
    mode?: string
  }

  input?: Record<string, unknown>

  execution?: {
    preferredTool?: string
    fallbackTools?: string[]
    timeoutMs?: number
    requiresVision?: boolean
    requiresConfirmation?: boolean
    riskLevel?: 'low' | 'medium' | 'high'
  }

  context?: {
    sourceStage?: string
    sourceIntent?: string
    sourceSkillRefs?: string[]
    sourceTraceId?: string
  }

  metadata?: Record<string, unknown>
}
```

### 4.1 关键字段说明

#### `capability`
系统级稳定标识。

#### `input`
保留实现所需参数，不在 v0 过度规范死。

#### `execution.preferredTool`
用于把 capability 路由到当前实现。

#### `execution.fallbackTools`
为未来多实现 / 多平台接入预留。

#### `context`
用于保留是从哪一层、哪个 skill、哪个 trace 来的。

---

## 5. 与当前 `ToolAction` 的关系

当前结构：

```ts
interface ToolAction {
  tool: string
  action: string
  params?: Record<string, unknown>
}
```

v0 不立刻废弃它，而是建议加一个转换层：

```text
Intent / Plan / Skill Hint
        ↓
CapabilityCommandV0
        ↓
ToolAction adapter
        ↓
Concrete tool implementation
```

也就是说：
- `CapabilityCommandV0` 是统一中间表示
- `ToolAction` 变成当前运行时适配层

---

## 6. 现有工具映射到 capability 的建议

### 6.1 adb

| 当前 action | 推荐 capability | 说明 |
|---|---|---|
| `back` | `device.tv.navigate.back` | 回退导航 |
| `home` | `device.tv.navigate.home` | 返回主页 |
| `open_app` | `device.tv.app.open` | 打开电视应用 |
| `get_ui_tree` | `device.tv.ui.inspect.tree` | 获取 UI 树 |
| `screenshot` | `device.tv.ui.inspect.screenshot` | 获取截图 |
| `find_text` | `device.tv.ui.find_text` | 查找文本 |
| `click_element` | `device.tv.ui.click_element` | 点击已定位元素 |
| `tap` | `device.tv.ui.tap` | 低层坐标点击 |
| `swipe` | `device.tv.ui.swipe` | 低层滑动 |
| `input_text` | `device.tv.ui.input_text` | 输入文本 |
| `ocr_local` / `ocr_api` | `device.tv.ui.inspect.ocr` | OCR 识别 |
| `multimodal_understand` | `device.tv.ui.inspect.multimodal` | 多模态理解 |
| `list_apps` | `device.tv.app.list` | 查询应用 |
| `list_devices` | `device.tv.device.list` | 查询设备 |
| `connect` | `device.tv.device.connect` | 建立连接 |
| `disconnect` | `device.tv.device.disconnect` | 断开连接 |

### 6.2 hami / Home Assistant

| 当前 action | 推荐 capability | 说明 |
|---|---|---|
| `xiaoai_execute` | `home.voice.execute` | 通过语音/家庭中枢执行命令 |
| `xiaoai_speak` | `home.voice.speak` | 让小爱说话 |
| `tv_remote` | `device.tv.remote.send` | 发送遥控指令 |

### 6.3 memory

| 当前能力 | 推荐 capability | 说明 |
|---|---|---|
| chat history read | `memory.chat.read` | 读取历史消息 |
| chat history append | `memory.chat.append` | 追加对话 |
| future episodic memory | `memory.episodic.record` | 记录事件经验 |
| future strategy memory | `memory.strategy.record` | 记录蒸馏后的策略 |

### 6.4 rule_engine

| 当前能力 | 推荐 capability | 说明 |
|---|---|---|
| rule match | `agent.fast.rule.match` | 规则匹配 |
| rule candidate generation | `agent.fast.rule.propose` | 生成规则候选 |

### 6.5 local_intent

| 当前能力 | 推荐 capability | 说明 |
|---|---|---|
| intent match | `agent.fast.intent.match` | 本地意图归一 |

### 6.6 success_paths

| 当前能力 | 推荐 capability | 说明 |
|---|---|---|
| search | `agent.fast.success_path.search` | 搜索经验路径 |
| record | `agent.memory.success_path.record` | 写入经验路径 |
| feedback | `agent.memory.success_path.feedback` | 记录反馈 |
| governance / merge | `agent.memory.success_path.govern` | 治理、合并、修复 |

### 6.7 llm_agent

| 当前能力 | 推荐 capability | 说明 |
|---|---|---|
| structured planning | `agent.deep.plan` | 深度规划 |
| future reflection | `agent.deep.reflect` | 执行后反思 |
| future self-orchestration | `agent.deep.orchestrate` | 生成工作流/子计划 |

---

## 7. Capability -> ToolAction 适配示例

### 示例 1：返回主页

```json
{
  "schemaVersion": "command_v0",
  "commandId": "cmd_001",
  "capability": "device.tv.navigate.home",
  "target": {
    "domain": "tv",
    "device": "tv_letv"
  },
  "operation": {
    "name": "home"
  },
  "execution": {
    "preferredTool": "adb",
    "requiresVision": false,
    "riskLevel": "low"
  },
  "context": {
    "sourceStage": "llm_agent",
    "sourceIntent": "go_home"
  }
}
```

适配成：

```json
{
  "tool": "adb",
  "action": "home"
}
```

### 示例 2：通过家庭中枢打开电视

```json
{
  "schemaVersion": "command_v0",
  "commandId": "cmd_002",
  "capability": "home.voice.execute",
  "target": {
    "domain": "home",
    "device": "tv_letv"
  },
  "operation": {
    "name": "execute",
    "value": "打开电视"
  },
  "input": {
    "command": "打开电视"
  },
  "execution": {
    "preferredTool": "hami",
    "riskLevel": "medium"
  },
  "context": {
    "sourceStage": "rule_engine",
    "sourceIntent": "open_device"
  }
}
```

适配成：

```json
{
  "tool": "hami",
  "action": "xiaoai_execute",
  "params": {
    "command": "打开电视"
  }
}
```

---

## 8. skills 在 v0 里的建议结构

未来每个 skill 至少应围绕 capability 来描述：

```yaml
skill_id: adb.targeting
capabilities:
  - device.tv.ui.find_text
  - device.tv.ui.click_element
  - device.tv.ui.tap
exposure_level: progressive
preconditions:
  - tv_connected
  - ui_context_available
risk_level: low
```

这意味着：
- skills 不只是 markdown 说明
- 可以逐步升级成“文档 + 半结构化 contract”

---

## 9. v0 之后的演进方向

### v1
- command schema 与 `IntentSchema` 更紧密耦合
- 引入 capability registry
- 引入 command validator

### v2
- visual workflow 节点直接以 capability command 为基本单元
- AI self-orchestration 输出 workflow IR，而不是直接输出 ToolAction

### v3
- 多实现工具接入
- capability routing based on policy / device availability / confidence / cost

---

## 10. 直接结论

HomeSense 下一阶段最重要的不是再继续直接扩 tool action，而是：

1. 先把现有能力统一命名成 `capability`
2. 用 `CapabilityCommandV0` 做新的中间表示
3. 让 `ToolAction` 退化为当前实现适配层
4. 让 `skills` 围绕 capability，而不是围绕底层脚本，逐步成为系统的统一披露层

一句话总结：

> **HomeSense 的下一步，不是让 graph 直接操纵更多底层 action，而是先建立 capability / command / skills 这层统一中间语言。**
