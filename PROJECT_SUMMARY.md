# HomeSense Agent 项目总结

## 一、项目背景

HomeSense 是一个智能家居语音控制系统，目标是通过自然语言控制家中的智能设备（电视、机顶盒、小爱音箱等）。

**核心特点：**
- 纯本地运行，无需云端
- 分层决策，逐级 fallback
- 一切皆工具，微内核架构

---

## 二、核心架构理念

| 理念 | 说明 |
|------|------|
| **一切皆工具** | adb、hami、memory、rule_engine、local_intent、llm_agent 都是独立、自洽的工具 |
| **工具自洽** | 每个工具有自己的代码、配置、数据库 |
| **微内核调度** | graph.ts 只做调度，不写业务逻辑，根据工具返回的 next 字段跳转 |
| **分层决策** | 记忆优先 → 规则引擎 → 本地意图 → 大模型（逐级 fallback） |

---

## 三、项目结构

```
HomeSense/
├── agent/                          # 后端（TypeScript + Fastify）
│   ├── src/
│   │   ├── index.ts               # Fastify HTTP 入口
│   │   ├── graph.ts               # LangGraph 图定义（单节点 + 条件边）
│   │   ├── state.ts               # AgentState 定义
│   │   └── tools/
│   │       ├── memory/            # 记忆工具（SQLite）
│   │       │   ├── chatDb.ts      # 对话数据库操作
│   │       │   ├── chat.db        # SQLite 数据库
│   │       │   └── tool.ts        # LangChain Tool 封装
│   │       ├── rule_engine/       # 规则引擎（关键词 + 同义词）
│   │       │   ├── database.ts    # SQLite 规则/同义词存储
│   │       │   ├── expander.ts    # 同义词扩展
│   │       │   ├── matcher.ts     # 匹配逻辑
│   │       │   ├── rule_engine.db # SQLite 数据库
│   │       │   └── tool.ts        # LangChain Tool 封装
│   │       ├── local_intent/      # 本地意图（BERT-tiny，待实现）
│   │       ├── llm_agent/         # 大模型（兜底，待实现）
│   │       ├── adb/               # ADB 工具（Python 子进程）
│   │       │   ├── adb.py         # Python 脚本
│   │       │   ├── wrapper.ts     # Node.js 调用封装
│   │       │   └── config.yaml    # 配置
│   │       ├── hami/              # Home Assistant 工具
│   │       │   ├── hami.py        # Python 脚本
│   │       │   ├── wrapper.ts     # Node.js 调用封装
│   │       │   └── config.yaml    # 配置
│   │       ├── success_paths/     # 成功路径记忆
│   │       └── web_search/        # 网页搜索
│   └── package.json
│
├── homesense-frontend/            # 前端（Vue 3 + Naive UI）
│   ├── src/
│   │   ├── views/
│   │   │   ├── chat/              # 聊天页面
│   │   │   ├── devices/           # 设备管理
│   │   │   └── config/            # 工具配置
│   │   ├── api/                   # API 封装
│   │   └── utils/                 # 工具函数
│   └── package.json
│
├── start-backend.ps1              # 后端启动脚本
├── start-frontend.ps1             # 前端启动脚本
└── start-all.ps1                  # 全部启动脚本
```

---

## 四、工具职责与状态

| 工具 | 职责 | 存储 | 状态 |
|------|------|------|------|
| **memory** | 对话历史存储 | SQLite (chat.db) | ✅ 完成 |
| **rule_engine** | 关键词匹配 + 同义词扩展 | SQLite (rule_engine.db) | ✅ 完成 |
| **local_intent** | 模糊指令 → 标准意图 | 模型权重文件 | ⏳ 待实现 |
| **llm_agent** | 复杂任务规划 + 工具调用 | 无 | ⏳ 待实现 |
| **adb** | 安卓设备控制（电视） | config.yaml | ✅ 脚本完成 |
| **hami** | Home Assistant 设备控制 | config.yaml | ✅ 脚本完成 |
| **success_paths** | 成功路径记忆 | SQLite | ⏳ 框架完成 |
| **web_search** | 网页搜索 | 无 | ⏳ 框架完成 |

---

## 五、调度逻辑（graph.ts）

### 单节点 + 条件边
只有一个节点 `call_tool`，根据工具返回的 `next` 字段决定下一步。

```typescript
// 工具返回格式
interface ToolResult {
  next: string;    // 下一个要执行的工具名，或 "end"
  data: any;       // 执行结果
  message: string; // 给用户的回复
}
```

### 典型流程
```
START → memory_query → rule_engine → local_intent → llm_agent → tools → save_memory → END
```

条件边由工具返回的 `next` 驱动，图本身无业务逻辑。

---

## 六、规则引擎设计

### 数据库表结构

**rules 表** - 标准触发词
```sql
CREATE TABLE rules (
  id INTEGER PRIMARY KEY,
  trigger TEXT NOT NULL UNIQUE,  -- 标准触发词
  response TEXT NOT NULL         -- 响应内容
);
```

**synonyms 表** - 同义词映射
```sql
CREATE TABLE synonyms (
  id INTEGER PRIMARY KEY,
  word TEXT NOT NULL,      -- 标准词
  synonym TEXT NOT NULL    -- 同义词
);
```

### 匹配流程
```
用户输入 "开启乐视电视机"
    ↓
同义扩展 → ["开启乐视电视机", "打开乐视电视机", "开启电视", "打开电视", ...]
    ↓
查 rules 表 → 命中 "打开乐视电视机"
    ↓
返回 response: "好的，打开乐视电视"
```

---

## 七、记忆系统设计

### 数据库表结构

**messages 表** - 对话历史
```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  role TEXT NOT NULL,        -- 'user' 或 'assistant'
  content TEXT NOT NULL,     -- 消息内容
  created_at DATETIME        -- UTC 时间
);
```

### API 接口
- `POST /api/chat` - 发送消息
- `GET /api/messages?limit=20&offset=0` - 获取历史消息

---

## 八、设备控制脚本

### ADB 工具 (adb.py)
控制安卓电视，支持：
- `tap(x, y)` - 点击
- `swipe(x1, y1, x2, y2)` - 滑动
- `press_key(key)` - 按键
- `open_app(package)` - 打开应用
- `screenshot()` - 截图
- `get_ui_tree()` - 获取 UI 树

### HAMI 工具 (hami.py)
通过 Home Assistant 控制设备：
- `xiaoai_speak(text)` - 小爱同学说话
- `xiaoai_execute(command)` - 小爱执行指令
- `tv_remote(device, command)` - 电视遥控

---

## 九、前端设计

### 技术栈
- Vue 3 + Vite
- Naive UI 组件库
- Pinia 状态管理

### 页面
- `/chat` - 聊天界面
- `/devices` - 设备管理
- `/config` - 工具配置

### 消息显示
- 时间转换：UTC → 中国时间 (UTC+8)
- 顺序：最新消息在下方
- 无限滚动：向上滚动加载历史

---

## 十、关键决策记录

| 决策 | 结论 |
|------|------|
| 规则引擎用模型吗？ | ❌ 不用，分词 + 词袋 + 同义词 |
| 本地意图用模型吗？ | ✅ 用，BERT-tiny |
| 记忆放哪？ | 统一放 memory 工具 |
| 成功路径放哪？ | memory 工具（episodic_memory 表） |
| 图有几个节点？ | 一个 call_tool 节点 |
| 条件边逻辑？ | 根据工具返回的 next 字段跳转 |
| 前端存储？ | ❌ 不用 localStorage 缓存，每次从后端加载 |
| 时间存储？ | UTC 时间存储，前端转换为中国时间显示 |

---

## 十一、待实现功能

| 优先级 | 任务 | 说明 |
|--------|------|------|
| P0 | 规则引擎完善 | 添加更多触发词和同义词 |
| P1 | 本地意图模型 | 训练/部署 BERT-tiny |
| P1 | 大模型集成 | OpenAI API 或本地模型 |
| P2 | 真实设备接入 | 调试 adb.py、hami.py |
| P2 | 前端完善 | 流式输出、打字机效果 |

---

## 十二、启动方式

```powershell
# 启动后端
.\start-backend.ps1

# 启动前端
.\start-frontend.ps1

# 同时启动
.\start-all.ps1
```

**服务地址：**
- 后端：http://localhost:3000
- 前端：http://localhost:9527

---

## 十三、已删除的旧项目

`edge-agent/` 目录已确认内容复制到 `agent/src/tools/` 中，可以安全删除。
