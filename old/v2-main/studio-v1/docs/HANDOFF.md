# HomeSense Studio - 交接文档
> 2026-05-31 | Commit: f2b65be

## 项目定位

HomeSense Studio 是一个 LLM-first 智能家居 Agent 平台。核心理念：LLM 恢复主体地位，闲聊和设备控制走同一个模型，工具是否开放由运行时决定。

产品形态分两面：
- **Chat**：自由对话 + 设备控制 + 工具调用 + 沙箱演练 + 经验沉淀
- **Studio (Workflow)**：可视化工作流编排 + 节点运行 + 设备能力集成 + 运行证据

底层共用：LLM 供应商、设备管理、CLI/能力注册、Skills、记忆资产、Trace/日志。

## 技术栈

- **后端**：Node.js + TypeScript + Fastify + better-sqlite3
- **前端**：Vue 3 + TypeScript + Vite
- **运行时**：LangGraph (ReAct graph) 驱动 Chat
- **数据库**：homesense.db（主库）+ chat.db（聊天记录），SQLite WAL 模式
- **外部服务**：bilibili-music（投屏/音乐/音箱，Python FastAPI，独立部署）

## 构建与测试

```bash
cd D:\files\HomeSense-Stdio

# 后端构建
npm run -w backend build

# 后端测试（24/25 通过，1个 pre-existing graph.test.ts 失败）
npm run -w backend test

# 前端构建
npm run -w frontend build

# 前端测试（26/26 通过，82 个用例）
npm run -w frontend test
```

## 模块清单与进度

### 已完成（代码链路已通）

| 模块 | 路径 | 说明 |
|------|------|------|
| Chat Runtime | `modules/chat/` | LangGraph ReAct 图，SSE 流式，工具调用，上下文窗口 |
| Chat Path Candidate | `modules/chat/path-candidate.ts` | 成功工具调用抽取为经验路径候选 |
| Context Completer | `modules/context-completer/` | LLM 上下文组装：设备清单、上下文窗口、轻量检索 |
| Runtime Context | `modules/runtime-context/` | TTL 上下文窗口、当前房间/设备、usage 估算 |
| Intent Router | `modules/intent-router/` | 轻意图提示：chat/device_control/device_query/memory_note/meta |
| Device Management | `modules/device/` | 设备表、房间、ping/在线、卡片投影、能力注册、运行清单 |
| Device Type Skill | `modules/device-type-skill/` | 按设备类型加载 SKILL.md |
| Device Agent Tools | `modules/device/device-agent-tools.ts` | LLM 工具：list_devices、get_skill、get_capabilities、rehearse、execute |
| Capability Registry | `modules/device/device-capability-registry.ts` | 统一设备能力注册层 |
| Runtime Manifest | `modules/device/device-runtime-manifest.ts` | 设备卡片 + 能力 schema + sample_arguments JSON |
| CLI Bridge | `modules/cli-bridge/` | mi-cli / adb-cli / bilibili-cast-bridge 统一调用 |
| Bilibili Cast Bridge | `packages/bilibili-cast-bridge/` | DLNA 投屏 + 音箱投屏，桥接 bilibili-music HTTP 服务 |
| DLNA Cast CLI | `skills/dlna-cast-cli/` | DLNA 投屏 executor + skill |
| Speaker Cast CLI | `skills/speaker-cast-cli/` | 音箱投屏 executor + skill |
| External Integrations | `modules/external-integrations/` | 外部能力源登记：HTTP/CLI/本地服务，bilibili-music 默认注册 |
| Integrations View | `frontend/views/IntegrationsView.vue` | 集成页：CLI 集成 + 外部能力源登记面板 |
| Runtime Capability Map | `modules/runtime-capability-map/` | 统一能力地图：device/executor/provider/node/skill |
| Assets View | `frontend/views/AssetsView.vue` | 资产页：能力地图、设备技能、记忆、通用技能 |
| Workflow Runtime | `modules/workflow/` | 节点运行、设备能力节点、子流程、重试、补偿 |
| Workflow Agent Tools | `modules/workflow/workflow-agent-tools.ts` | Chat->Workflow 桥接：list/preview/run |
| Workflow Run Quality | `modules/workflow/run-quality.ts` | 成功/失败计数，复用分/证据状态 |
| Workflow Preview | `modules/workflow/preview-workflow.ts` | 设备能力预演校验 |
| Memory Assets | `modules/memory-assets/` | 经验路径、用户反馈、设备偏好存储 |
| Knowledge Compiler | `modules/knowledge-compiler/` | 离线编译：entities/experiences/workflows -> compiled_knowledge |
| LLM Provider | `modules/llm-provider/` | Chat/Embedding/Rerank/Vision 供应商管理 |
| Rule Engine | `modules/rule-engine/` | 上下文感知的规则匹配 |
| Compensation | `modules/compensation/` | 失败节点生成补偿观察任务 |
| Vision Tools | `modules/vision-tools/opencv.ts` | OpenCV 占位（stub） |
| Screen Understand | `modules/screen-understand/` | 多模态识图占位（stub） |
| Device/device-*/SKILL.md` | tv-box / phone / speaker / computer 设备类型说明书 |
| Sandbox | `skills/sandbox-mi-cli/` | MI CLI 沙箱演练 runner |

### 未完成 / 占位

| 模块 | 状态 | 说明 |
|------|------|------|
| L2 候选召回 | 接口存在，算法暂缓 | candidate-plan 有基础融合，但向量/重排序未接 |
| 向量 Embedding | DB 表存在，未实际运行 | compiled_knowledge_embeddings 表已建，缺真实 embedding 写入 |
| 重排序 Rerank | 模块存在，未接入运行时 | rerank-service 有实现，未连到 Chat/Workflow |
| 图数据库 | DB 表存在（graph_nodes/graph_edges），未使用 | 未来用于记忆宫殿/空间地图 |
| 多模态视觉 | stub 存在 | vision-tools/screen-understand 只有框架，缺真实 provider 调用 |
| OpenCV | stub 存在 | vision-tools/opencv.ts 只有接口定义 |
| 长期记忆 | 规划中 | Assets 页有占位卡片 |
| MCP Skills | 规划中 | Assets 页有占位卡片 |
| 消息网关 | 规划中 | Assets 页有占位卡片 |

## 关键设计决策

1. **LLM 主体地位**：闲聊和 agent 能力走同一个 LLM，工具是否开放由运行时控制
2. **渐进式披露**：设备 skill 不在首轮全量塞入，按需加载
3. **沙箱优先**：真实执行前必须演练，沙箱使用真实设备能力模型
4. **trace 不持久化**：SSE 实时展示，不存 DB
5. **思考链不展示**：`<think>` 标签在流式解析和入库时剥离
6. **独立 chat.db**：与 homesense.db 分离
7. **单用户不分会话**：消息平铺，游标分页
8. **外部能力源**：bilibili-music 作为独立 HTTP 服务，通过 external-integrations 登记，不合并进主项目
9. **能力地图**：runtime-capability-map 汇聚 device/executor/provider/node/skill 五域

## 目录结构

```
HomeSense-Stdio/
  packages/
    backend/          # Fastify 后端
      src/
        modules/      # 44 个功能模块
        db/           # SQLite schema + migrations
        app.ts        # 入口，注册所有路由
    frontend/         # Vue 3 前端
      src/
        views/        # 15 个页面
        components/   # 通用组件
        api/          # 后端 API 客户端
        features/     # 业务逻辑：chat / studio
    bilibili-cast-bridge/  # 投屏桥接（Node.js，调用 bilibili-music HTTP）
    shared/           # 前后端共享常量
  skills/             # SKILL.md + EXECUTOR.json
    device-*/         # 设备类型说明书
    dlna-cast-cli/    # DLNA 投屏
    speaker-cast-cli/ # 音箱投屏
    sandbox-mi-cli/   # MI 沙箱演练
    adb-cli/          # ADB 调试
  docs/
    design/           # 6 份设计文档
    STATUS.md         # 详细状态清单
    HANDOFF.md        # 本文件
```

## 外部依赖：bilibili-music

独立 Python FastAPI 项目，部署在 `http://127.0.0.1:28974`。

功能模块（无需登录）：
- `/api/v1/music/search` - B站音乐搜索
- `/api/v1/music/audio/{bvid}` - 音频解析
- `/api/v1/music/stream/{bvid}` - 音频流代理
- `/api/v1/cast/devices` - DLNA 设备发现
- `/api/v1/cast/sniff` - 视频嗅探
- `/api/v1/cast/start` - DLNA 投屏
- `/api/v1/cast/control` - 投屏控制
- `/api/v1/cast/status/{udn}` - 投屏状态
- `/api/v1/playlist/*` - 本地播放列表
- `/api/v1/favlist/*` - B站收藏夹

功能模块（需小米账号登录）：
- `/api/v1/speaker/login` - 账号密码/Cookie/QR 码登录
- `/api/v1/speaker/devices` - 音箱设备列表
- `/api/v1/speaker/play` - 推送音乐到音箱
- `/api/v1/speaker/control` - 播放控制
- `/api/v1/speaker/volume` - 音量控制
- `/api/v1/speaker/qr/*` - 二维码登录流程

HomeSense 通过 `bilibili-cast-bridge` 桥接调用，不直接暴露 HTTP 细节。

## 已知问题

1. `graph.test.ts` 有 1 个 pre-existing 失败（上下文裁剪策略与断言不一致）
2. tmp/ 目录下有运行日志，已在 .gitignore 排除
3. 部分旧模块（agent-adapter/a2a-client）仍有历史代码，未清理
4. CRLF 警告：部分文件使用 CRLF 换行，Git 会提示

## 下一步建议

1. **打通 L2 召回链路**：接通 embedding 写入 + rerank 排序，让 candidate-plan 真正工作
2. **多模态视觉**：接通真实 vision provider，让 screen-understand 能识图
3. **bilibili-music 音箱登录**：在集成页暴露小米账号登录入口，让 speaker 功能可用
4. **清理旧模块**：agent-adapter / a2a-client / devtest 中的历史代码
5. **修复 graph.test.ts**：对齐上下文裁剪策略和测试断言
6. **记忆宫殿 / 图数据库**：graph_nodes/graph_edges 表已建，可开始探索空间记忆
