# HomeSense Agent 架构文档

> 生成时间: 2026-04-10
> 版本: v2.0 (渐进式披露架构)

---

## 一、项目概述

HomeSense 是一个智能家居 Agent 系统，基于 **渐进式披露哲学 (Progressive Disclosure Philosophy)** 设计。系统通过多层级检索和匹配机制，从快速精确匹配到慢速语义理解，逐层递进地处理用户意图。

### 1.1 核心目标

- **快速响应**: 规则引擎优先，毫秒级匹配
- **精确执行**: Success Path 存储执行序列，可直接执行
- **持续学习**: Experience 文档供 LLM 参考，LLM 成功后反补知识库
- **渐进披露**: Skill/Experience 按需加载，不过度暴露

### 1.2 目录结构

```
d:\files\HomeSense\
├── agent/                          # Agent 主项目
│   ├── src/
│   │   ├── graph.ts               # LangGraph 状态图定义
│   │   ├── state.ts               # 状态定义 (AgentState)
│   │   ├── index.ts               # 入口文件
│   │   ├── config/
│   │   │   └── progressive_disclosure.yaml  # 配置文件
│   │   ├── tools/                 # 工具目录
│   │   │   ├── adb/               # ADB 工具 (东芝电视)
│   │   │   │   ├── skills/        # Skill 文档 (人写)
│   │   │   │   ├── wrapper.ts     # 工具封装
│   │   │   │   ├── config.yaml
│   │   │   │   └── adb.py         # Python CLI
│   │   │   ├── hami/              # HAMI 工具 (机顶盒/小爱)
│   │   │   │   ├── skills/
│   │   │   │   ├── wrapper.ts
│   │   │   │   ├── config.yaml
│   │   │   │   └── hami.py        # Python CLI
│   │   │   ├── intent_classifier/ # 意图分类器
│   │   │   │   ├── tool.ts        # 调用 8001 服务
│   │   │   │   └── config.yaml
│   │   │   ├── context_completer/ # 上下文设备补全
│   │   │   │   ├── tool.ts        # 拼接设备关键词
│   │   │   │   ├── skills/
│   │   │   │   └── config.yaml
│   │   │   ├── rule_engine/       # 规则引擎
│   │   │   │   ├── tool.ts
│   │   │   │   ├── matcher.ts
│   │   │   │   ├── expander.ts
│   │   │   │   ├── database.ts
│   │   │   │   ├── rules.yaml
│   │   │   │   ├── rule_engine.db
│   │   │   │   └── skills/        # Skill 文档 (人写)
│   │   │   ├── local_intent/      # 意图归一化
│   │   │   │   ├── tool.ts        # sqlite-vec 向量数据库
│   │   │   │   ├── data/intents.db
│   │   │   │   ├── skills/
│   │   │   │   └── config.yaml
│   │   │   ├── success_paths/     # Success Path 管理
│   │   │   │   ├── tool.ts
│   │   │   │   ├── data/paths.json
│   │   │   │   ├── data/governance.json
│   │   │   │   └── skills/
│   │   │   ├── skill_loader/      # Skill 加载器 (grep)
│   │   │   │   ├── tool.ts
│   │   │   │   └── config.yaml
│   │   │   ├── experience_retrieval/  # Experience 检索 (grep)
│   │   │   │   └── tool.ts
│   │   │   ├── experience_writer/ # Experience 写入
│   │   │   │   ├── tool.ts
│   │   │   │   ├── config.yaml
│   │   │   │   └── skills/
│   │   │   ├── llm_agent/         # LLM Agent
│   │   │   │   ├── tool.ts
│   │   │   │   ├── config.yaml
│   │   │   │   └── skills/
│   │   │   ├── memory/            # 记忆系统
│   │   │   │   ├── chatDb.ts      # 聊天历史
│   │   │   │   ├── llmCaseDb.ts   # LLM 案例
│   │   │   │   ├── chat.db
│   │   │   │   ├── llm_cases.db
│   │   │   │   └── workflow_candidates.db
│   │   │   └── web_search/       # 网页搜索
│   │   ├── utils/
│   │   │   └── SseEmitter.ts     # SSE 事件发射
│   │   └── workflowRegistry.ts
│   └── package.json
│
└── intent-service/                # 意图分类服务 (外部)
    ├── main.py                    # FastAPI 服务
    ├── data/intents.json          # 意图数据
    └── requirements.txt
```

---

## 二、核心架构

### 2.1 执行链路图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              用户输入                                         │
│                                │                                             │
│                                ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     intent_router (意图分类)                          │   │
│  │                      8001 向量服务 (轻量)                             │   │
│  │              chat vs command 分类 (100-300ms)                         │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                             │
│              ┌─────────────────┴─────────────────┐                          │
│              │                                   │                          │
│         chat │                              command │                      │
│              │                                   │                          │
│              ▼                                   ▼                          │
│            END                          ┌────────────────────┐              │
│                                       │  context_completer   │              │
│                                       │   拼接设备关键词     │              │
│                                       │ "看B站" → "在东芝电视│              │
│                                       │     看B站"          │              │
│                                       └────────────────────┘              │
│                                               │                           │
│                                               ▼                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        rule_engine (规则匹配)                          │   │
│  │                          精确匹配 (快)                                │   │
│  │                    命中 → tool_executor                              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                             │
│              ┌─────────────────┴─────────────────┐                          │
│              │                                   │                          │
│         命中 │                              未命中 │                      │
│              │                                   │                          │
│              ▼                                   ▼                          │
│  ┌────────────────────┐      ┌─────────────────────────────────────────┐   │
│  │   tool_executor    │      │         intent_normalizer                │   │
│  │     执行工具        │      │          sqlite-vec 向量归一化             │   │
│  └────────────────────┘      │          语义匹配 (384维向量)              │   │
│                              └─────────────────────────────────────────┘   │
│                                           │                               │
│                              ┌────────────┴────────────┐                   │
│                         命中 │                     未命中 │                  │
│                              │                           │                  │
│                              ▼                           ▼                   │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                  success_experience_retrieval                          │   │
│  │                       Success Path 检索                               │   │
│  │                    intent → actions 快速执行                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                             │
│              ┌─────────────────┴─────────────────┐                          │
│              │                                   │                          │
│         有 Path │                             无 Path │                     │
│              │                                   │                          │
│              ▼                                   ▼                          │
│  ┌────────────────────┐              ┌────────────────────────────────┐   │
│  │   tool_executor    │              │         llm_agent               │   │
│  │     执行工具        │              │          LLM 决策                │   │
│  └────────────────────┘              │   按需调用 skill_loader (grep)    │   │
│                                      │   按需调用 experience_retrieval   │   │
│                                      └────────────────────────────────┘   │
│                                               │                           │
│                                               ▼                           │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         tool_executor                                 │   │
│  │                          执行工具                                     │   │
│  │                    adb / hami / web_search                          │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                             │
│                                ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      experience_writer                                │   │
│  │                    写入 Experience (LLM知识库)                       │   │
│  │                    写入 Success Path (执行序列)                       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                │                                             │
│                                ▼                                             │
│                              END                                            │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 2.2 节点职责表

| 节点 | 技术 | 职责 | 速度 |
|------|------|------|------|
| `intent_router` | 8001 向量服务 | chat/command 分类 | 100-300ms |
| `context_completer` | 规则匹配 | 拼接设备关键词 | <10ms |
| `rule_engine` | SQLite 规则库 | 精确意图匹配 | <10ms |
| `intent_normalizer` | sqlite-vec | 语义归一化 | 50-100ms |
| `success_experience_retrieval` | JSON 文件 | Success Path 检索 | <5ms |
| `llm_agent` | LLM API | 决策 + ReAct | 1-3s |
| `tool_executor` | CLI 工具 | 执行动作 | 变量 |
| `experience_writer` | LLM + 文件 | 写入记忆 | 1-2s |

---

## 三、数据流

### 3.1 状态定义 (AgentState)

```typescript
// 核心状态字段
AgentState = {
  input: string,                    // 用户原始输入
  completedInput: string,            // 拼接设备后的输入
  currentStage: string,              // 当前阶段

  // 意图相关
  context: {
    intentType: "chat" | "command", // 意图类型
    intentConfidence: number,        // 置信度
  },
  intent: IntentSchema,             // 意图结构
  intentConfidence: number,

  // 规则引擎相关
  ruleMatched: boolean,             // 规则是否命中
  ruleActions: ToolAction[],        // 规则动作

  // Success Path / Experience
  autoExecutePath: boolean,         // 是否有自动执行路径
  matchedExperience: ExperienceDoc,  // 匹配的 Experience
  loadedSkills: string[],          // 已加载的 Skills

  // LLM Agent 相关
  reactSteps: Array<{
    thought: string,
    action: ToolAction | null,
    observation: string
  }>,
  stageResult: StageResult,         // 阶段结果
  stageTrace: StageTraceEntry[],    // 执行轨迹

  // 执行结果
  toolResults: ToolResult[],        // 工具执行结果
  isComplete: boolean,              // 是否完成
  finalResponse: string,            // 最终回复

  // 消息
  messages: BaseMessage[],          // 消息历史
}
```

### 3.2 关键数据结构

#### ToolAction
```typescript
interface ToolAction {
  tool: string;      // 工具名: "adb", "hami", "web_search"
  action: string;    // 动作名: "open_bilibili", "back", "home"
  params?: Record<string, unknown>;  // 参数
}
```

#### IntentSchema
```typescript
interface IntentSchema {
  schemaVersion: "v0";
  intent: string;                    // 意图: "open_app", "navigate_back"
  target?: {
    device?: string;                 // 设备: "toshiba_tv", "stb"
    app?: string;                    // 应用: "bilibili"
  };
  operation?: {
    action?: string;
  };
  context?: {
    recentMentionedDevices?: Array<{ device: string; score: number }>;
  };
  rawInput: string;                  // 原始输入
}
```

#### ExperienceDoc
```typescript
interface ExperienceDoc {
  type: "experience";
  intent: string;            // 意图标识
  keywords: string[];        // 关键词 (用于 grep)
  title: string;             // 标题
  content: string;           // 完整内容 (LLM 参考)
  filePath?: string;         // 文件路径
}
```

---

## 四、外部依赖

### 4.1 外部服务

| 服务 | 端口 | 技术 | 用途 |
|------|------|------|------|
| Intent Service | 8001 | FastAPI + SentenceTransformer | 意图分类 (chat/command) |

#### Intent Service API

| 端点 | 方法 | 用途 |
|------|------|------|
| `/health` | GET | 健康检查 |
| `/classify` | POST | 意图分类 |
| `/embed` | POST | 生成向量嵌入 |
| `/similarity` | POST | 相似度计算 |
| `/reload` | POST | 重载意图数据 |

#### Intent Service 配置

- **模型**: `paraphrase-multilingual-MiniLM-L12-v2` (支持中文)
- **向量维度**: 384
- **数据文件**: `intent-service/data/intents.json`

### 4.2 工具依赖

| 工具 | 技术 | 用途 |
|------|------|------|
| `adb` | Python CLI | 东芝电视控制 |
| `hami` | Python CLI | 机顶盒/小爱音箱控制 |
| `better-sqlite3` | Node.js | SQLite 数据库 |
| `sqlite-vec` | Node.js | 向量搜索扩展 |

---

## 五、渐进式披露机制

### 5.1 两类记忆系统

| 系统 | 来源 | 用途 | 格式 |
|------|------|------|------|
| **Success Path** | LLM 执行成功后生成 | 快速执行路径 | JSON (intent → actions) |
| **Experience** | LLM 执行成功后生成 | LLM 知识库参考 | Markdown |

### 5.2 检索方式

| 检索器 | 数据来源 | 匹配方式 | 使用场景 |
|--------|----------|----------|----------|
| `rule_engine` | rules.yaml | 精确匹配 | 快速响应 |
| `skill_loader` | skills/*.md | Grep 关键词 | 按需加载 |
| `experience_retrieval` | experiences/*.md | Grep 关键词 | 按需加载 |
| `local_intent` | sqlite-vec | 向量相似度 | 语义归一化 |
| `success_paths` | paths.json | 精确匹配 | 快速执行 |

### 5.3 Grep 渐进式披露

**skill_loader** 和 **experience_retrieval** 都使用 Grep 渐进式披露：

```typescript
// 1. 从输入提取关键词
function extractKeywords(input: string): string[] {
  const stopWords = new Set(["我", "想", "要", "的", ...]);
  const segments = input.split(/[\s，。！？]/).filter(s => !stopWords.has(s));
  const bigrams = extractBigrams(input);
  return [...segments, ...bigrams];
}

// 2. Grep 搜索
function grepSkills(options: GrepSkillOptions): SkillRegistryEntry[] {
  for (const file of allSkillFiles) {
    const raw = readFileSync(file.path, "utf-8");
    const keywordMatch = keywords.some(kw => raw.includes(kw));
    if (keywordMatch) {
      matches.push(entry);
    }
  }
  return matches;
}

// 3. 渐进式披露
const skillContents = matches
  .map(m => `## ${m.ref}\n${m.content}`)
  .join("\n\n");
```

---

## 六、工具执行

### 6.1 可用工具

| 工具名 | 执行方式 | 支持的动作 |
|--------|----------|-----------|
| `adb` | Python CLI | `open_bilibili`, `open_dangbei`, `back`, `home`, `screenshot` |
| `hami` | Python CLI | `xiaoai_execute` (语音控制) |
| `web_search` | HTTP API | `search` |

### 6.2 工具执行流程

```typescript
async function executeToolAction(action: ToolAction): Promise<ToolResult> {
  const tool = getTool(action.tool);
  if (!tool) return { success: false, error: "Tool not found" };

  const input = { action: action.action, ...action.params };
  const result = await tool.invoke(input);

  return {
    tool: action.tool,
    action: action.action,
    success: result.success,
    data: result,
  };
}
```

---

## 七、设备与场景

### 7.1 支持的设备

| 设备 | 控制方式 | Skill 目录 |
|------|----------|-----------|
| 东芝电视 | adb | tools/adb/skills/ |
| 机顶盒 | hami | tools/hami/skills/ |
| 小爱音箱 | hami | tools/hami/skills/ |

### 7.2 意图归一化样本

意图归一化数据库存储在 `sqlite-vec` 中，包含以下标准意图：

```typescript
const intents = [
  // 设备控制
  { text: "打开东芝电视", normalized_text: "open_toshiba_tv", device: "toshiba_tv" },
  { text: "打开机顶盒", normalized_text: "open_stb", device: "stb" },
  { text: "小爱音箱放歌", normalized_text: "play_music", device: "xiaoai_speaker" },

  // 应用操作
  { text: "在东芝电视看B站", normalized_text: "open_bilibili_tv", device: "toshiba_tv" },
  { text: "用机顶盒看B站", normalized_text: "open_bilibili_stb", device: "stb" },

  // 导航
  { text: "返回", normalized_text: "navigate_back" },
  { text: "主页", normalized_text: "go_home" },
];
```

---

## 八、配置

### 8.1 意图分类配置

文件: `tools/intent_classifier/config.yaml`

```yaml
chat_keywords: []
command_indicators: []
confidence_threshold: 0.6
use_vector_service: true  # 使用 8001 向量服务
```

### 8.2 意图归一化配置

文件: `tools/local_intent/config.yaml`

```yaml
model: "local-intent"
confidence_threshold: 0.5
enabled: true
use_vector_db: true
vector_db_path: "./data/intents.db"
```

### 8.3 渐进式披露配置

文件: `config/progressive_disclosure.yaml`

```yaml
skill_loader:
  max_results: 5
  exposure_level: "progressive"

success_retrieval:
  use_vector_service: true

experience:
  directory: "./experiences"
  max_results: 3

context_completer:
  decay_factor: 0.8
  recent_window: 20
```

---

## 九、流程示例

### 9.1 示例: "我想看B站"

```
用户输入: "我想看B站"

1. intent_router (8001服务)
   输入: "我想看B站"
   输出: { intent: "command", score: 0.488 }

2. context_completer
   输入: "我想看B站"
   输出: "在东芝电视看B站" (拼接设备)

3. rule_engine
   输入: "在东芝电视看B站"
   输出: { matched: false } (未命中)

4. intent_normalizer (sqlite-vec)
   输入: "在东芝电视看B站"
   输出: { matched: true, intent: "open_bilibili_tv", actions: [...] }

5. success_experience_retrieval
   输入: "open_bilibili_tv"
   输出: null (无 Success Path)

6. llm_agent
   输入: "在东芝电视看B站"
   输出: { action: { tool: "adb", action: "open_bilibili" } }

7. tool_executor
   输入: { tool: "adb", action: "open_bilibili" }
   输出: { success: true }

8. experience_writer
   写入 Experience + Success Path
```

### 9.2 示例: "返回"

```
用户输入: "返回"

1. intent_router
   输出: { intent: "command", score: 0.7 }

2. context_completer
   输出: "返回" (无需拼接)

3. rule_engine
   输出: { matched: true, actions: [{ tool: "adb", action: "back" }] }

4. tool_executor (直接命中规则)
   执行: adb back
   输出: { success: true }
```

---

## 十、注意事项

### 10.1 性能考量

- **意图分类**: 100-300ms (依赖 8001 服务)
- **规则匹配**: <10ms (本地)
- **向量搜索**: 50-100ms (本地 sqlite-vec)
- **LLM 调用**: 1-3s (外部 API)

### 10.2 依赖关系

- **8001 服务**: 必须运行，否则意图分类失败
- **sqlite-vec**: 向量维度必须为 384
- **adb/hami**: Python CLI 工具需在 PATH 中

### 10.3 扩展点

- **添加新设备**: 在对应工具目录添加 skill 文件
- **添加新意图**: 在 `local_intent/tool.ts` 的 `loadNormalizedIntents()` 添加
- **添加新规则**: 在 `rule_engine/rules.yaml` 添加
- **LLM 反补**: 成功后自动写入 Experience 和 Success Path
