# HomeSense

<div align="center">

**本地优先的智能家居 Agent 系统**

基于渐进式披露哲学设计 | 自然语言控制 | 持续学习

[English](#english) | [中文](#中文)

</div>

---

## 中文

### 项目理念

HomeSense 是一个**本地优先**的智能家居 Agent 系统，核心理念是**渐进式披露 (Progressive Disclosure)**：

- **快速响应优先**：规则引擎毫秒级匹配，优先使用已验证的执行路径
- **语义理解兜底**：当精确匹配失败时，才调用 LLM 进行语义理解和决策
- **持续学习进化**：每次成功执行后，自动沉淀为可复用的经验（Success Path + Experience）
- **按需加载知识**：Skill 和 Experience 按需检索，避免过度暴露干扰 LLM 判断

```
用户输入 → 意图分类 → 规则匹配 → 向量归一化 → Success Path → LLM Agent → 执行 → 经验沉淀
           (快)        (快)        (中)          (快)         (慢)      (变量)    (自动)
```

### 核心特性

| 特性 | 说明 |
|------|------|
| 🚀 **快速响应** | 规则引擎精确匹配，毫秒级响应 |
| 🧠 **智能理解** | LLM 语义理解，处理复杂意图 |
| 📚 **持续学习** | 自动沉淀执行经验，越用越聪明 |
| 🔧 **可扩展** | 模块化工具设计，易于添加新设备 |
| 🔒 **本地优先** | 数据本地存储，隐私安全 |

### 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        用户输入                                  │
│                           │                                      │
│                           ▼                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              intent_router (意图分类)                     │   │
│   │               chat vs command 分类                        │   │
│   └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│            ┌──────────────┴──────────────┐                       │
│            │                             │                       │
│       chat │                        command │                    │
│            │                             │                       │
│            ▼                             ▼                       │
│          END              ┌────────────────────────┐             │
│                          │    context_completer    │             │
│                          │     (设备上下文补全)     │             │
│                          └────────────────────────┘             │
│                                     │                            │
│                                     ▼                            │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │              rule_engine (规则匹配)                       │   │
│   │                 精确匹配 → 直接执行                        │   │
│   └─────────────────────────────────────────────────────────┘   │
│                           │                                      │
│              ┌────────────┴────────────┐                         │
│              │                         │                         │
│         命中 │                    未命中 │                        │
│              │                         │                         │
│              ▼                         ▼                         │
│   ┌──────────────────┐    ┌────────────────────────────────┐    │
│   │  tool_executor   │    │      intent_normalizer         │    │
│   │    (执行工具)     │    │       (向量语义归一化)          │    │
│   └──────────────────┘    └────────────────────────────────┘    │
│                                       │                          │
│                          ┌────────────┴────────────┐             │
│                          │                         │             │
│                     命中 │                    未命中 │            │
│                          │                         │             │
│                          ▼                         ▼             │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │              success_paths (Success Path 检索)            │  │
│   │                  intent → actions 快速执行                │  │
│   └──────────────────────────────────────────────────────────┘  │
│                           │                                      │
│              ┌────────────┴────────────┐                         │
│              │                         │                         │
│         有 Path │                   无 Path │                    │
│              │                         │                         │
│              ▼                         ▼                         │
│   ┌──────────────────┐    ┌────────────────────────────────┐    │
│   │  tool_executor   │    │          llm_agent             │    │
│   │    (执行工具)     │    │       (LLM 决策 + ReAct)       │    │
│   └──────────────────┘    └────────────────────────────────┘    │
│                                       │                          │
│                                       ▼                          │
│   ┌──────────────────────────────────────────────────────────┐  │
│   │                experience_writer (经验沉淀)               │  │
│   │         写入 Success Path + Experience 文档               │  │
│   └──────────────────────────────────────────────────────────┘  │
│                           │                                      │
│                           ▼                                      │
│                         END                                      │
└─────────────────────────────────────────────────────────────────┘
```

### 项目结构

```
HomeSense/
├── agent/                          # Agent 后端服务
│   ├── src/
│   │   ├── graph.ts               # LangGraph 状态图定义
│   │   ├── state.ts               # 状态定义
│   │   ├── tools/                 # 工具模块
│   │   │   ├── adb/               # ADB 工具 (东芝电视)
│   │   │   ├── hami/              # HAMI 工具 (机顶盒/小爱)
│   │   │   ├── rule_engine/       # 规则引擎
│   │   │   ├── local_intent/      # 意图归一化
│   │   │   ├── success_paths/     # Success Path 管理
│   │   │   ├── llm_agent/         # LLM Agent
│   │   │   └── ...                # 其他工具
│   │   └── config/                # 配置文件
│   └── package.json
│
├── homesense-frontend/            # Vue 3 前端
│   ├── src/
│   │   ├── views/                 # 页面组件
│   │   ├── components/            # 通用组件
│   │   ├── store/                 # Pinia 状态管理
│   │   └── api/                   # API 接口
│   └── package.json
│
├── intent-service/                # 意图分类服务
│   ├── main.py                    # FastAPI 服务
│   └── data/intents.json          # 意图数据
│
└── docs/                          # 文档
    └── specs/                     # 规格文档
```

### 技术栈

| 层级 | 技术 |
|------|------|
| **后端** | TypeScript, Fastify, LangGraph, LangChain |
| **前端** | Vue 3, Vite, TypeScript, Naive UI, Pinia |
| **AI/ML** | LLM API, SentenceTransformers, sqlite-vec |
| **存储** | SQLite, JSON 文件 |
| **设备控制** | ADB, Python CLI |

### 快速开始

#### 环境要求

- Node.js 18+
- Python 3.10+
- SQLite3

#### 1. 启动意图分类服务

```powershell
cd intent-service
pip install -r requirements.txt
python main.py
```

服务将在 `http://127.0.0.1:8001` 启动。

#### 2. 启动后端

```powershell
cd agent
npm install
npm run build
npm start
```

后端服务将在 `http://127.0.0.1:3000` 启动。

#### 3. 启动前端

```powershell
cd homesense-frontend
npm install
npm run dev
```

前端开发服务器将启动。

#### 一键启动 (Windows)

```powershell
.\start-all.cmd
```

### 配置说明

在运行前，请配置以下文件：

| 文件 | 说明 |
|------|------|
| `agent/.env.example` | 环境变量配置 (复制为 `.env`) |
| `agent/src/tools/adb/config.yaml` | ADB 设备配置 |
| `agent/src/tools/hami/config.yaml` | HAMI 设备配置 |
| `agent/src/tools/llm_agent/config.yaml` | LLM API 配置 |
| `homesense-frontend/.env` | 前端环境变量 |

### 支持的设备

| 设备 | 控制方式 | 功能 |
|------|----------|------|
| 东芝电视 | ADB | 打开应用、导航控制、截图 |
| 机顶盒 | HAMI | 电源控制 |
| 小爱音箱 | HAMI | 语音控制 |

### 渐进式披露机制

HomeSense 采用两层记忆系统：

| 系统 | 来源 | 用途 | 格式 |
|------|------|------|------|
| **Success Path** | LLM 执行成功后生成 | 快速执行路径 | JSON |
| **Experience** | LLM 执行成功后生成 | LLM 知识库参考 | Markdown |

检索优先级：

1. **规则引擎** - 精确匹配，毫秒级
2. **向量归一化** - 语义匹配，50-100ms
3. **Success Path** - 历史成功路径，<5ms
4. **LLM Agent** - 智能决策，1-3s

### 示例对话

```
用户: 我想看B站

系统流程:
1. intent_router → 分类为 command
2. context_completer → 补全为 "在东芝电视看B站"
3. rule_engine → 未命中
4. intent_normalizer → 匹配到 open_bilibili_tv
5. llm_agent → 决策调用 adb.open_bilibili
6. tool_executor → 执行成功
7. experience_writer → 沉淀经验

响应: 已为您在东芝电视打开B站
```

```
用户: 返回

系统流程:
1. intent_router → 分类为 command
2. rule_engine → 直接命中规则
3. tool_executor → 执行 adb back

响应: 已执行返回操作
```

### 开发路线

- [x] 核心架构搭建
- [x] 规则引擎
- [x] LLM Agent
- [x] Success Path 管理
- [x] 前端界面
- [ ] 更多设备支持
- [ ] 语音交互
- [ ] 自动化场景

### 贡献指南

欢迎贡献！请阅读 `docs/specs/AGENTS.md` 了解开发规范。

### 许可证

待添加

---

## English

### Philosophy

HomeSense is a **local-first** smart home Agent system built on **Progressive Disclosure** philosophy:

- **Fast Response First**: Rule engine millisecond-level matching, prioritizing verified execution paths
- **Semantic Understanding Fallback**: Only invoke LLM for semantic understanding when exact matching fails
- **Continuous Learning**: Automatically accumulate reusable experience (Success Path + Experience) after each successful execution
- **On-demand Knowledge Loading**: Skills and Experiences are retrieved on-demand, avoiding over-exposure that could interfere with LLM judgment

### Key Features

| Feature | Description |
|---------|-------------|
| 🚀 **Fast Response** | Rule engine exact matching, millisecond-level response |
| 🧠 **Smart Understanding** | LLM semantic understanding for complex intents |
| 📚 **Continuous Learning** | Auto-accumulate execution experience, smarter over time |
| 🔧 **Extensible** | Modular tool design, easy to add new devices |
| 🔒 **Local-First** | Local data storage, privacy and security |

### Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | TypeScript, Fastify, LangGraph, LangChain |
| **Frontend** | Vue 3, Vite, TypeScript, Naive UI, Pinia |
| **AI/ML** | LLM API, SentenceTransformers, sqlite-vec |
| **Storage** | SQLite, JSON files |
| **Device Control** | ADB, Python CLI |

### Quick Start

#### Requirements

- Node.js 18+
- Python 3.10+
- SQLite3

#### 1. Start Intent Service

```powershell
cd intent-service
pip install -r requirements.txt
python main.py
```

Service runs at `http://127.0.0.1:8001`.

#### 2. Start Backend

```powershell
cd agent
npm install
npm run build
npm start
```

Backend runs at `http://127.0.0.1:3000`.

#### 3. Start Frontend

```powershell
cd homesense-frontend
npm install
npm run dev
```

### Supported Devices

| Device | Control Method | Features |
|--------|----------------|----------|
| Toshiba TV | ADB | Open apps, navigation, screenshot |
| Set-top Box | HAMI | Power control |
| Xiaoai Speaker | HAMI | Voice control |

### Progressive Disclosure Mechanism

Two-layer memory system:

| System | Source | Purpose | Format |
|--------|--------|---------|--------|
| **Success Path** | Generated after LLM success | Fast execution path | JSON |
| **Experience** | Generated after LLM success | LLM knowledge reference | Markdown |

Retrieval priority:

1. **Rule Engine** - Exact match, milliseconds
2. **Vector Normalization** - Semantic match, 50-100ms
3. **Success Path** - Historical success paths, <5ms
4. **LLM Agent** - Intelligent decision, 1-3s

### License

To be added

---

<div align="center">

**HomeSense** - 让智能家居更智能

</div>
