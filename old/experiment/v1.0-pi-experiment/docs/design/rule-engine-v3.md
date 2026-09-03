# 规则引擎设计 v3

> 更新: 2026-05-28

## 一、核心定位

规则引擎是 LLM 的**前置快速通道**。用户说一句话，规则引擎在毫秒级完成解析并触发动作，不走 LLM、不花 token、无延迟。

```
用户输入 ─→ [ 规则引擎 ] ──命中──→ 执行动作（设备控制 / 工作流 / 脚本）
                │
              未命中
                │
                ↓
            [ LLM / Agent ]
```

规则是**用户预编写的模板**，不是 AI 推理出来的。引擎的智能在于同义词扩展 + 动态变量解析，不在于语义理解深度。

---

## 二、数据模型

### 2.1 同义词组 `synonym_groups`

管理语义等价词。一组内的词在匹配时互相等价。

```sql
CREATE TABLE synonym_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,     -- '打开', '电视', '客厅灯'
  category TEXT NOT NULL DEFAULT 'verb' CHECK (category IN ('verb','device','room','custom')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE synonyms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES synonym_groups(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  is_canonical INTEGER NOT NULL DEFAULT 0,
  UNIQUE(group_id, word)
);
```

示例：

| group name | category | members |
|---|---|---|
| 打开 | verb | 打开(canon), 开启, 启动, 开一下, 开开 |
| 关闭 | verb | 关闭(canon), 关掉, 关一下, 关上 |
| 电视 | device | 电视(canon), 电视机, TV |
| 空调 | device | 空调(canon), AC, 冷气 |

`is_canonical=1` 的成员是该组的代表词，用于日志和回显。

### 2.2 规则模板 `rule_templates`

规则的核心。每条规则是一个**模板模式**，变量在匹配时动态解析。

```sql
CREATE TABLE rule_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pattern TEXT NOT NULL,          -- 模板模式，如 '{打开}{客厅}{灯}'
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE rule_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES rule_templates(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('device','workflow','script')),
  action_target TEXT NOT NULL DEFAULT '',   -- 'power', 'brightness', workflow slug, etc.
  params_template TEXT NOT NULL DEFAULT '{}', -- JSON with $variable references
  "order" INTEGER NOT NULL DEFAULT 0
);
```

### 2.3 上下文 `user_context`

追踪用户当前所在位置，决定"这个灯"指哪个。

```sql
CREATE TABLE user_context (
  key TEXT PRIMARY KEY,           -- 'current_room'
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 2.4 匹配日志 `rule_match_log`

```sql
CREATE TABLE rule_match_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  input_text TEXT NOT NULL,
  rule_id INTEGER NULL,
  resolved_vars TEXT NOT NULL DEFAULT '{}',  -- JSON: 解析出的变量
  action_type TEXT NOT NULL DEFAULT '',
  action_target TEXT NOT NULL DEFAULT '',
  confidence REAL NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---
、模板语法

### 3.1 变量槽

| 语法 | 含义 | 匹配规则 | 示例 |
|---|---|---|---|
| `{verb}` | 同义词组（动词类） | 匹配 `category='verb'` 的同义词组的任一成员 | `{打开}` ← "开一下" |
| `{device}` | 设备名 | 匹配 `user_devices.name` 或其别名 | `{电视}` ← "电视机" |
| `{room}` | 房间名 | 匹配 `rooms.name` 或其别名 | `{客厅}` ← "大厅" |
| `{=N}` | 精确数字 | 匹配连续数字，绑定到变量 N | `{=26}` ← "26" |
| `{text}` | 任意文本 | 捕获剩余文本 | `{text}` ← "周杰伦的歌" |
| `字面量` | 不带花括号 | 必须精确匹配 | `放歌` |

### 3.2 模板示例

```
{打开}{电视}
    匹配: "开一下电视", "打开电视机", "开启TV"
    解析: verb=打开, device=电视

{打开}{客厅}{灯}
    匹配: "开一下客厅的灯", "打开大厅灯"
    解析: verb=打开, room=客厅, device=灯

{打开}{灯}
    匹配: "开灯", "打开灯"
    需要上下文: 房间未指定，用 current_room 决定哪个灯

{调到}{=N}{度}
    匹配: "调到26度", "温度调到24度"
    解析: verb=调到, $N=26

{打开}{设备}{播放}{text}
    匹配: "打开电视播放周杰伦"
    解析: device=电视, verb=播放, text=周杰伦
```

### 3.3 模板编译

编译时将 pattern 拆分为 token 序列：

```
'{打开}{客厅}{灯}'
  → [{type:'verb', group:'打开'}, {type:'room', name:'客厅'}, {type:'device', name:'灯'}]

'{调到}{=N}{度}'
  → [{type:'verb', group:'调到'}, {type:'number', var:'N'}, {type:'literal', text:'度'}]
```

---

## 四、匹配管道

```
原始输入
  │
  ▼
┌─────────────────┐
│ 1. 文本预处理     │  去标点、全半角、繁简、trim
└────────┬────────┘
         ▼
┌─────────────────┐
│ 2. 同义词扩展     │  加载同义词组，生成候选变体集合
└────────┬────────┘
         ▼
┌─────────────────┐
│ 3. 实体提取       │  识别输入中的房间名、设备名、数字
└────────┬────────┘
         ▼
┌─────────────────┐
│ 4. 模板匹配       │  按优先级遍历规则，尝试匹配每个候选
└────────┬────────┘
         ▼
┌─────────────────┐
│ 5. 实体解析       │  {灯} → 哪个房间的哪个灯？解析为 user_device.id
└────────┬────────┘
         ▼
┌─────────────────┐
│ 6. 动作触发       │  调用 executor 执行
└─────────────────┘
```

### 4.1 文本预处理

```typescript
function normalize(input: string): string {
  return input
    .trim()
    .replace(/[，。！？、,.!?]/g, '')   // 去标点
    .replace(/的/g, '')                 // 去虚词："客厅的灯" → "客厅灯"
    .replace(/[A-Z]/g, c => c.toLowerCase())  // 半角小写
}
```

### 4.2 同义词扩展

```
输入: "开一下客厅灯"
扩展候选: ["开一下客厅灯", "打开客厅灯", "开启客厅灯", "开一下大厅灯", "打开大厅灯", ...]
```

不是把所有候选逐个全量匹配。而是：
- 识别输入中的同义词组成员 → "开一下" 命中 "打开" 组
- 用组内所有成员替换 → 生成候选

### 4.3 实体提取

从输入中提取已知的实体引用：

```typescript
interface ExtractedEntities {
  rooms: string[]       // 识别到的房间名
  devices: string[]     // 识别到的设备名/类型
  numbers: number[]     // 识别到的数字
  verbs: string[]       // 识别到的动词（已归一化到 canonical）
}

// 输入: "开一下客厅灯"
// 结果: { rooms: ['客厅'], devices: ['灯'], numbers: [], verbs: ['打开'] }
```

设备名匹配策略（按优先级）：
1. **精确匹配** `user_devices.name`：用户自定义名 "小爱"、"乐视"
2. **同义词组匹配**：`category='device'` 的组成员 "电视" → 找 device_type=television 的设备
3. **device_type 中文映射**：`television → 电视`，`speaker → 音箱`，`outlet → 插座` 等

### 4.4 模板匹配

编译后的模板 token 序列 vs取的实体：

```
模板: {打开}{客厅}{灯}
token: [verb:打开, room:客厅, device:灯]

输入: "打开客厅灯"
提取: { verbs:['打开'], rooms:['客厅'], devices:['灯'] }

匹配:
  verb:打开 ← verbs 包含 '打开' ✅
  room:客厅 ← rooms 包含 '客厅' ✅
  device:灯 ← devices 包含 '灯' ✅
  → 命中，priority=0
```

匹配规则：
- `verb` 槽：输入 verbs 中有一个是该同义词组的成员 → 命中
- `room` 槽：输入 rooms 中有一个匹配该房间名 → 命中
- `device` 槽：输入 devices 中有一个匹配该设备名/类型 → 命中
- `number` 槽：输入 numbers 中有数字 → 命中，绑定值
- `literal`：必须逐字匹配

### 4.5 实体解析

匹配到模板后，需要把变量解析为具体的数据库记录。

```
输入: "打开灯"
提取: { verbs:['打开'], devices:['灯'] }
匹配模板: {打开}{灯}

需要解析: "灯" 是哪个设备？
  ↓
user_devices 中 name LIKE '%灯%' 的设备：
  - 客厅大灯 (room_id=1, 客厅)
  - 卧室台灯 (room_id=2, 卧室)

多个候选 → 进入消歧：
  1. 当前房间上下文 current_room='客厅' → 选"客厅大灯"
  2. 无上下文 → 返回所有候选，要求用户选
```

#### 消歧优先级

| 优先级 | 条件 | 结果 |
|---|---|---|
| 1 | 输入中指定了房间 | 取该房间下的匹配设备 |
| 2 | `user_context.current_room` 存在 | 取当前房间下的匹配设备 |
| 3 | 只有一个匹配设备 | 直接选中 |
| 4 | 多个匹配、无上下文 | 返回候选列表，让用户选/设上下文 |

#### 上下文来源（NAS 场景）

NAS 没有 GPS，上下文设置方式：
- **手动设置**："我在客厅" → `SET current_room='客厅'`
- **对话推断**：用户连续操作客厅设备 → 自动推断 current_room
- **默认房间**：`user_context('default_room')` 用户预设
- **交互设备推断**：如果用户通过客厅的音箱说话 → current_room=客厅

---

## 五、动作类型

### 5.1 设备能力 `device`

触发设备的具体能力。

```json
{
  "action_type": "device",
  "action_target": "power",          // capability name
  "params_template": "{\"state\":\"on\"}"
}
```

变量引用（params_template 中用 `$` 前缀）：

```json
// {调到}{=N}{度} → params: {"value": "$N"}
{
  "action_type": "device",
  "action_target": "target_temperature",
  "params_template": "{\"value\":\"$N\"}"
}
```

设备解析结果注入 `$device_id`、`$room_id`。

### 5.2 工作流 `workflow`

触发预编排的工作流。

```json
{
  "action_type": "workflow",
  "action_target": "movie-mode",    // workflow slug 或 id
  "params_template": "{\"room\":\"$room\"}"
}
```

### 5.3 脚本 `script`

自定义逻辑（未来扩展）。

```json
{
  "action_type": "script",
  "action_target": "say_goodnight",
  "params_template": "{}"
}
```

### 5.4 多动作顺序执行

一条规则可以挂多个 action，按 `order` 顺序执行：

```
规则: "{电影模式}"
  action 1: workflow.trigger('movie-mode')
  action 2: device.execute('power', 'off')   // 如果工作流里没关灯
```

---

## 六、完整示例

### 场景 1：简单设备控制

```
用户: "开一下电视"

预处理 → "开一下电视"
同义扩展 → 识别 "开一下" ∈ 打开组 → canonical: "打开"
实体提取 → { verbs:['打开'], devices:['电视'] }
模板匹配 → {打开}{电视} ✅
实体解析 → user_devices WHERE name='电视' OR device_type='television'
  → 找到: 乐视电视 (id=1, room_id=1, 客厅)
动作触发 → device.execute(device_id=1, capability='power',state:'on'})
```

### 场景 2：带房间指定

```
用户: "把卧室的空调调到26度"

预处理 → "把卧室空调调到26度"  (去虚词 "的")
同义扩展 → "调到" ∈ 调到组
实体提取 → { verbs:['调到'], rooms:['卧室'], devices:['空调'], numbers:[26] }
模板匹配 → {调到}{=N}{度} ✅
实体解析 → user_devices WHERE room='卧室' AND (name='空调' OR device_type LIKE '%空调%')
  → 找到: 卧室空调 (id=5, room_id=2)
动作触发 → device.execute(device_id=5, capability='target_temperature', params={value:26})
```

### 场景 3：需要上下文消歧

```
用户: "开灯"

预处理 → "开灯"
同义扩展 → "开" ∈ 打开组 → "开灯" → "打开灯"
实体提取 → { verbs:['打开'], devices:['灯'] }
模板匹配 → {打开}{灯} ✅
实体解析 → user_devices WHERE name LIKE '%灯%' OR device_type='light'
  → 找到 3 个灯: 客厅大灯、卧室台灯、书房灯
消歧 → current_room='客厅' → 选"客厅大灯"
动作触发 → device.execute(device_id=3, capability='power', params={state:'on'})
```

### 场景 4：带数字参数

```
用户: "亮度调到80"

预处理 → "亮度调到80"
同义扩展 → "调到" ∈ 调到组
实体提取 → { verbs:['调到'], numbers:[80] }
模板匹配 → {调到}{=N} ✅
实体解析 → 无设备指定，根据"亮度"关键词 → 找最近操作的灯
动作触发 → device.execute(device_id=?, capability='brightness', params={value:80})
```

### 场景 5：触发工作流

```
用户: "电影模式"

预处理 → "电影模式"
模板匹配 → "电影模式" (literal) ✅
动作触发 → workflow.trigger('movie-mode')
  → 关灯 + 打开电视 + 打开投影
```

### 场景 6：设置上下文

```
用户: "我在客厅"

预处理 → "我在客厅"
模板匹配 → {我在}{room} ✅
动作 → SET user_context.current_room = '客厅'
回显: "好的，当前在客厅"
```

---

## 七、规则引擎作为前置层

```
用户消息
  │
  ▼
┌──────────────────┐
│   规则引擎匹配     │
└──────┬───────────┘
       │
   命中? ──是──→ 执行动作 → 返回结果（不走 LLM）
       │
       否
       │
       ▼
┌──────────────────┐
│  LLM / Agent     │
└──────────────────┘
```

在 Chat 流程中，规则引擎挂载为**前置拦截器**：

```typescript
// chat routes
const ruleResult = ruleEngine.match(normalizedInput)
if (ruleResult && ruleResult.confidence >= 0.8) {
  // 直接执行，SSE 返回结果
  const execResult = await ruleEngine.execute(ruleResult)
  return sseReply(execResult)
}
// 走 LLM
```

---

## 八、扩展方向

1. **规则自动生成**：用户添加设备时，自动生成基础规则模板（"打开{设备名}"）
2. **模糊匹配 fallback**：同义词没覆盖的，用编辑距离 1 做软匹配
3. **规则学习**：LLM 处理过的高频指令，建议用户转为规则（降本）
4. **多语言**：同义词组支持中英文混合
5. **语音指令优化**：针对语音输入的口语化处理（"帮我开一下那个灯嘛"）
